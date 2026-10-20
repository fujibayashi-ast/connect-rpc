import { expect, test } from "bun:test";
import {
  Category,
  ChangeType,
  type WatchContactsResponse,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { Code } from "@connectrpc/connect";
import {
  type Api,
  describeEach,
  listAll,
  rejection,
  validContact,
} from "./helpers.ts";

// 購読を開く。テストの最後に abort で閉じる
function watch(api: Api, options: { timeoutMs?: number } = {}) {
  const abort = new AbortController();
  const stream = api.client.watchContacts(
    {},
    { signal: abort.signal, ...options },
  );
  const it = stream[Symbol.asyncIterator]();
  return { abort, stream, it };
}

// ストリームから 1 件読む。届かなければ失敗させる（テストが固まらないように）
async function next(
  it: AsyncIterator<WatchContactsResponse>,
  ms = 3000,
): Promise<WatchContactsResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${ms}ms 以内に届かなかった`)),
      ms,
    );
  });
  try {
    const r = await Promise.race([it.next(), timeout]);
    if (r.done) throw new Error("ストリームが終わった");
    return r.value;
  } finally {
    clearTimeout(timer);
  }
}

// 自分が作った連絡先（id）の変更だけを、n 件読む
async function changesOf(
  it: AsyncIterator<WatchContactsResponse>,
  id: string,
  n: number,
) {
  const out: { type: ChangeType; name: string }[] = [];
  while (out.length < n) {
    const res = await next(it);
    if (res.event.case === "change" && res.event.value.contact?.id === id) {
      out.push({
        type: res.event.value.type,
        name: res.event.value.contact.name,
      });
    }
  }
  return out;
}

describeEach("Server streaming（WatchContacts）", (api) => {
  test("最初に現在の一覧（snapshot）が届く", async () => {
    const existing = await api.create({ name: "既存" });
    const w = watch(api);

    try {
      const first = await next(w.it);

      expect(first.event.case).toBe("snapshot");
      const ids =
        first.event.case === "snapshot"
          ? first.event.value.contacts.map((c) => c.id)
          : [];
      expect(ids).toContain(existing.id);
    } finally {
      w.abort.abort();
    }
  });

  test("作成・更新・削除が、起きた順に届く", async () => {
    const w = watch(api);

    try {
      await next(w.it); // snapshot

      const created = await api.create({ name: "新規" });
      await api.client.updateContact({
        id: created.id,
        contact: validContact({
          name: "更新後",
          email: created.email,
          category: Category.SUPPORT,
        }),
      });
      await api.client.deleteContact({ id: created.id });

      expect(await changesOf(w.it, created.id, 3)).toEqual([
        { type: ChangeType.CREATED, name: "新規" },
        { type: ChangeType.UPDATED, name: "更新後" },
        // 削除は、削除する前の Contact が届く
        { type: ChangeType.DELETED, name: "更新後" },
      ]);
    } finally {
      w.abort.abort();
    }
  });

  test("複数の購読者の両方に、同じ変更が届く", async () => {
    const a = watch(api);
    const b = watch(api);

    try {
      await next(a.it);
      await next(b.it);

      const created = await api.create({ name: "みんなに" });

      expect(await changesOf(a.it, created.id, 1)).toEqual([
        { type: ChangeType.CREATED, name: "みんなに" },
      ]);
      expect(await changesOf(b.it, created.id, 1)).toEqual([
        { type: ChangeType.CREATED, name: "みんなに" },
      ]);
    } finally {
      a.abort.abort();
      b.abort.abort();
    }
  });

  test("購読を中止しても、サーバーはそのあとも普通に動く", async () => {
    const w = watch(api);
    await next(w.it);

    w.abort.abort();

    const err = await rejection(w.it.next());
    expect(err.code).toBe(Code.Canceled);
    const created = await api.create({ name: "中止のあと" });
    const contacts = await listAll(api.client);
    expect(contacts.map((c) => c.id)).toContain(created.id);
  });

  test("サーバーに期限だけを伝えると、サーバーが deadline_exceeded で終える", async () => {
    // クライアントの期限（タイマー）を使わず、Connect-Timeout-Ms ヘッダーだけを送る。
    // ストリームのリクエストは、フラグ 1 バイト + 長さ 4 バイト + JSON のエンベロープ
    const body = new Uint8Array([0, 0, 0, 0, 2, 0x7b, 0x7d]); // {}
    const res = await fetch(
      `${api.target.url}/contact.v1.ContactService/WatchContacts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/connect+json",
          "Connect-Protocol-Version": "1",
          "Connect-Timeout-Ms": "300",
        },
        body,
      },
    );

    // サーバーが期限で終えるとストリームが閉じ、最後のエンベロープにコードが入る
    const text = new TextDecoder().decode(await res.arrayBuffer());

    expect(text).toContain('"deadline_exceeded"');
    expect(text).not.toContain('"canceled"');
  });

  test("期限が来ると、ストリームは deadline_exceeded で終わる", async () => {
    const w = watch(api, { timeoutMs: 300 });
    const started = performance.now();

    try {
      await next(w.it); // snapshot
      const err = await rejection(next(w.it, 3000));

      expect(err.code).toBe(Code.DeadlineExceeded);
      expect(performance.now() - started).toBeLessThan(2000);
    } finally {
      w.abort.abort();
    }
  });
});
