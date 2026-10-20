import { expect, test } from "bun:test";
import { Code } from "@connectrpc/connect";
import { describeEach, rawGet, rejection } from "./helpers.ts";

describeEach("ListContacts のページング", ({ target, client, create }) => {
  test("ページに分けても、登録順に重複なくそろう", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    const c = await create({ name: "C" });

    // 他のデータがあっても崩れないよう、1 件ずつめくって、自分が作った分だけを比べる
    const seen: string[] = [];
    let pageToken = "";
    do {
      const res = await client.listContacts({ pageSize: 1, pageToken });
      expect(res.contacts.length).toBeLessThanOrEqual(1);
      seen.push(...res.contacts.map((x) => x.id));
      pageToken = res.nextPageToken;
    } while (pageToken);

    const mine = [a.id, b.id, c.id];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((id) => mine.includes(id))).toEqual(mine);
  });

  test("次のページがあるときだけ next_page_token が入る", async () => {
    await create({ name: "A" });
    await create({ name: "B" });

    const first = await client.listContacts({ pageSize: 1 });
    expect(first.contacts.length).toBe(1);
    expect(first.nextPageToken).not.toBe("");

    // 最後のページまで進むと、トークンは空になる
    let pageToken = first.nextPageToken;
    let last = first;
    while (pageToken) {
      last = await client.listContacts({ pageSize: 1, pageToken });
      pageToken = last.nextPageToken;
    }
    expect(last.nextPageToken).toBe("");
  });

  test("めくる途中で削除しても、飛んだり重複したりしない", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    const c = await create({ name: "C" });
    const d = await create({ name: "D" });

    const seen: string[] = [];
    let pageToken = "";
    do {
      const res = await client.listContacts({ pageSize: 1, pageToken });
      seen.push(...res.contacts.map((x) => x.id));
      // a を読んだ直後に、まだ読んでいない b を消す（b は a より後に登録した）
      if (res.contacts.some((x) => x.id === a.id)) {
        await client.deleteContact({ id: b.id });
      }
      pageToken = res.nextPageToken;
    } while (pageToken);

    expect(new Set(seen).size).toBe(seen.length);
    const mine = [a.id, b.id, c.id, d.id];
    expect(seen.filter((id) => mine.includes(id))).toEqual([a.id, c.id, d.id]);
  });

  test("壊れた page_token は invalid_argument", async () => {
    // 順に: base64url でない / 数字でない / "+5" / "0" / "-1" / "1e3"
    for (const pageToken of ["abc", "!!!", "KzU", "MA", "LTE", "MWUz"]) {
      const err = await rejection(client.listContacts({ pageToken }));
      expect(err.code).toBe(Code.InvalidArgument);
    }
  });

  test("page_size が上限を超える・負のときは検証で弾かれる", async () => {
    for (const pageSize of [101, -1]) {
      const err = await rejection(client.listContacts({ pageSize }));
      expect(err.code).toBe(Code.InvalidArgument);
    }
  });

  test("GET でもページングできる", async () => {
    await create({ name: "A" });
    await create({ name: "B" });

    const res = await rawGet(target, "ListContacts", { pageSize: 1 });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contacts?: unknown[];
      nextPageToken?: string;
    };
    expect(body.contacts?.length).toBe(1);
    expect(body.nextPageToken).toBeTruthy();
  });
});
