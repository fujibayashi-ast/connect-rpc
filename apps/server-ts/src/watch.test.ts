import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { create } from "@bufbuild/protobuf";
import {
  Category,
  ChangeType,
  ContactSchema,
  CreateContactRequestSchema,
  DeleteContactRequestSchema,
  UpdateContactRequestSchema,
  WatchContactsRequestSchema,
  WatchContactsResponseSchema,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import { createContactService } from "./contact.ts";

// ハンドラが使う signal だけを持つ ctx
const ctxOf = (signal: AbortSignal) =>
  ({ signal }) as unknown as HandlerContext;

function setup() {
  const hub = new EventEmitter();
  const service = createContactService(hub);
  const abort = new AbortController();
  const ctx = ctxOf(abort.signal);

  const createContact = async (name: string, email: string) => {
    const res = await service.createContact(
      create(CreateContactRequestSchema, {
        contact: { name, email, category: Category.GENERAL },
      }),
      ctx,
    );
    if (!res.contact) throw new Error("contact がない");
    return create(ContactSchema, res.contact);
  };

  const watch = () => {
    const it = service
      .watchContacts(create(WatchContactsRequestSchema, {}), ctx)
      [Symbol.asyncIterator]();
    const next = async () => {
      const r = await it.next();
      if (r.done) throw new Error("ストリームが終わった");
      return create(WatchContactsResponseSchema, r.value);
    };
    return { it, next };
  };

  return { hub, service, abort, ctx, createContact, watch };
}

describe("watchContacts", () => {
  test("最初に現在の一覧が届き、そのあと変更が起きた順に届く", async () => {
    const { service, ctx, createContact, watch } = setup();
    const existing = await createContact("既存", "existing@example.com");
    const w = watch();

    const first = await w.next();
    expect(first.event.case).toBe("snapshot");
    expect(
      first.event.case === "snapshot" &&
        first.event.value.contacts.map((c) => c.id),
    ).toEqual([existing.id]);

    const created = await createContact("新規", "new@example.com");
    await service.updateContact(
      create(UpdateContactRequestSchema, {
        id: created.id,
        contact: {
          name: "更新後",
          email: "new@example.com",
          category: Category.SUPPORT,
        },
      }),
      ctx,
    );
    await service.deleteContact(
      create(DeleteContactRequestSchema, { id: created.id }),
      ctx,
    );

    const changes = [await w.next(), await w.next(), await w.next()].map((r) =>
      r.event.case === "change"
        ? [
            r.event.value.type,
            r.event.value.contact?.name,
            r.event.value.contact?.id,
          ]
        : null,
    );
    expect(changes).toEqual([
      [ChangeType.CREATED, "新規", created.id],
      [ChangeType.UPDATED, "更新後", created.id],
      // 削除は、削除する前の Contact が届く
      [ChangeType.DELETED, "更新後", created.id],
    ]);
  });

  test("中止すると購読が外れる", async () => {
    const { hub, abort, watch } = setup();
    const w = watch();
    await w.next();
    expect(hub.listenerCount("change")).toBe(1);

    abort.abort();

    // 中止しても終わらない場合に、テストが固まらず失敗するよう、時間で区切る
    const hung = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("中止しても終わらない")), 1000),
    );
    await expect(Promise.race([w.next(), hung])).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(hub.listenerCount("change")).toBe(0);
  });

  test("期限切れで中止されたら、deadline_exceeded を投げる（canceled にしない）", async () => {
    const { abort, watch } = setup();
    const w = watch();
    await w.next();

    abort.abort(
      new ConnectError("the operation timed out", Code.DeadlineExceeded),
    );

    await expect(w.next()).rejects.toMatchObject({
      code: Code.DeadlineExceeded,
    });
  });

  test("読むのをやめても購読が外れる", async () => {
    const { hub, watch } = setup();
    const w = watch();
    await w.next();
    expect(hub.listenerCount("change")).toBe(1);

    await w.it.return?.();

    expect(hub.listenerCount("change")).toBe(0);
  });

  test("複数の購読者の両方に同じ変更が届く", async () => {
    const { createContact, watch } = setup();
    const a = watch();
    const b = watch();
    await a.next();
    await b.next();

    const created = await createContact("A", "a@example.com");

    for (const w of [a, b]) {
      const r = await w.next();
      expect(r.event.case === "change" && r.event.value.contact?.id).toBe(
        created.id,
      );
    }
  });
});
