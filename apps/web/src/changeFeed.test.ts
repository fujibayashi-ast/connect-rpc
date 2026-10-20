import { describe, expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import {
  Category,
  ChangeType,
  type Contact,
  ContactSchema,
  WatchContactsResponseSchema,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { describeEvent } from "./changeFeed.ts";

const contact = (name: string): Contact =>
  create(ContactSchema, {
    id: name,
    name,
    email: `${name}@example.com`,
    category: Category.GENERAL,
  });

const snapshot = (...contacts: Contact[]) =>
  create(WatchContactsResponseSchema, {
    event: { case: "snapshot", value: { contacts } },
  });

const change = (type: ChangeType, c?: Contact) =>
  create(WatchContactsResponseSchema, {
    event: { case: "change", value: { type, contact: c } },
  });

describe("describeEvent", () => {
  test("snapshot は接続したことと件数", () => {
    expect(describeEvent(snapshot(contact("A"), contact("B")))).toBe(
      "接続しました（現在 2 件）",
    );
    expect(describeEvent(snapshot())).toBe("接続しました（現在 0 件）");
  });

  test("created / updated / deleted は種類と名前", () => {
    const a = contact("山田太郎");

    expect(describeEvent(change(ChangeType.CREATED, a))).toBe("追加: 山田太郎");
    expect(describeEvent(change(ChangeType.UPDATED, a))).toBe("更新: 山田太郎");
    expect(describeEvent(change(ChangeType.DELETED, a))).toBe("削除: 山田太郎");
  });

  test("未知の種類や contact のない change は出さない", () => {
    expect(
      describeEvent(change(ChangeType.UNSPECIFIED, contact("A"))),
    ).toBeUndefined();
    expect(describeEvent(change(ChangeType.CREATED))).toBeUndefined();
  });

  test("event が空なら出さない", () => {
    expect(describeEvent(create(WatchContactsResponseSchema))).toBeUndefined();
  });
});
