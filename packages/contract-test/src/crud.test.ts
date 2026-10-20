import { expect, test } from "bun:test";
import { equals } from "@bufbuild/protobuf";
import {
  Category,
  ContactSchema,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { Code } from "@connectrpc/connect";
import { describeEach, listAll, rejection, validContact } from "./helpers.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describeEach("CRUD", (api) => {
  test("Create はサーバーが UUID を採番し、入力の id は無視する", async () => {
    const supplied = "11111111-1111-4111-8111-111111111111";
    const contact = await api.create({ id: supplied, name: "採番" });

    expect(contact.id).toMatch(uuid);
    expect(contact.id).not.toBe(supplied);
    expect(contact.name).toBe("採番");
  });

  test("Get は Create と同じ値を返す", async () => {
    const created = await api.create({
      phone: "0312345678",
      category: Category.SUPPORT,
      message: "こんにちは",
    });

    const { contact } = await api.client.getContact({ id: created.id });

    expect(contact).toBeDefined();
    expect(equals(ContactSchema, contact ?? created, created)).toBe(true);
    expect(contact?.phone).toBe("0312345678");
    expect(contact?.category).toBe(Category.SUPPORT);
  });

  test("List は登録順に並ぶ", async () => {
    const a = await api.create({ name: "A" });
    const b = await api.create({ name: "B" });
    const c = await api.create({ name: "C" });

    const contacts = await listAll(api.client);

    // 他のデータがあっても崩れないよう、自分が作った分だけを取り出して比べる
    const mine = [a.id, b.id, c.id];
    expect(contacts.map((x) => x.id).filter((id) => mine.includes(id))).toEqual(
      mine,
    );
  });

  test("Update は全フィールドを置き換え、id は変わらない", async () => {
    const created = await api.create({
      phone: "0312345678",
      category: Category.GENERAL,
      message: "古い内容",
    });

    const next = validContact({
      name: "更新後",
      category: Category.SUPPORT,
      // phone と message を空にすると消える（部分更新ではない）
      phone: "",
      message: "",
    });
    const res = await api.client.updateContact({
      id: created.id,
      contact: next,
    });

    expect(res.contact?.id).toBe(created.id);
    const { contact } = await api.client.getContact({ id: created.id });
    expect(contact?.id).toBe(created.id);
    expect(contact?.name).toBe("更新後");
    expect(contact?.email).toBe(next.email ?? "");
    expect(contact?.category).toBe(Category.SUPPORT);
    expect(contact?.phone).toBe("");
    expect(contact?.message).toBe("");
  });

  test("Delete のあとは Get も Delete も NotFound", async () => {
    const created = await api.create();

    await api.client.deleteContact({ id: created.id });

    const get = await rejection(api.client.getContact({ id: created.id }));
    expect(get.code).toBe(Code.NotFound);
    const del = await rejection(api.client.deleteContact({ id: created.id }));
    expect(del.code).toBe(Code.NotFound);
  });
});
