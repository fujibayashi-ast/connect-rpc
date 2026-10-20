import { expect, test } from "bun:test";
import { Code } from "@connectrpc/connect";
import {
  describeEach,
  rejection,
  serverViolations,
  uniqueEmail,
  validContact,
} from "./helpers.ts";

const missingId = "00000000-0000-4000-8000-000000000000";

describeEach("エラー", (api) => {
  test("email の重複は AlreadyExists（大文字小文字を区別しない）", async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    await api.create({ email });

    const err = await rejection(
      api.client.createContact({
        contact: validContact({ email: email.toUpperCase() }),
      }),
    );

    expect(err.code).toBe(Code.AlreadyExists);
    // 検証エラーと同じ型 (Violations) で届くので、クライアントは同じ処理で扱える
    expect(serverViolations(err)).toEqual([
      "contact.email|contact.email_unique",
    ]);
  });

  test("Update で他の連絡先の email にすると AlreadyExists", async () => {
    const other = await api.create();
    const mine = await api.create();

    const err = await rejection(
      api.client.updateContact({
        id: mine.id,
        contact: validContact({ email: other.email }),
      }),
    );

    expect(err.code).toBe(Code.AlreadyExists);
    expect(serverViolations(err)).toEqual([
      "contact.email|contact.email_unique",
    ]);
  });

  test("Update で自分自身の email のままなら成功する", async () => {
    const mine = await api.create();

    const res = await api.client.updateContact({
      id: mine.id,
      contact: validContact({ email: mine.email, name: "名前だけ変更" }),
    });

    expect(res.contact?.name).toBe("名前だけ変更");
  });

  test("存在しない id は NotFound（Get / Update / Delete）", async () => {
    // 関数にして 1 件ずつ実行する（先に Promise を作ると、未処理の rejection になる）
    const calls = [
      () => api.client.getContact({ id: missingId }),
      () =>
        api.client.updateContact({ id: missingId, contact: validContact() }),
      () => api.client.deleteContact({ id: missingId }),
    ];
    for (const call of calls) {
      const err = await rejection(call());
      expect(err.code).toBe(Code.NotFound);
    }
  });

  test("検証エラーと重複が同時なら、検証が先に返る", async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    await api.create({ email });

    const err = await rejection(
      api.client.createContact({
        contact: validContact({ email, name: "   " }),
      }),
    );

    expect(err.code).toBe(Code.InvalidArgument);
    expect(serverViolations(err)).toEqual([
      "contact.name|contact.name_not_blank",
    ]);
  });

  test("重複でない email は何度でも登録できる", async () => {
    await api.create({ email: uniqueEmail() });
    await api.create({ email: uniqueEmail() });
  });
});
