import { describe, expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import {
  Category,
  CreateContactRequestSchema,
  GetContactRequestSchema,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { Code } from "@connectrpc/connect";
import {
  browserViolations,
  type ContactInit,
  describeEach,
  rejection,
  serverViolations,
  validContact,
} from "./helpers.ts";

// 期待する違反（フィールドのパス|ruleId）。空なら有効な入力
const cases: { name: string; contact: ContactInit; expected: string[] }[] = [
  { name: "有効な入力", contact: {}, expected: [] },

  // 標準ルール + 独自 CEL
  {
    name: "name が空白だけ",
    contact: { name: "   " },
    expected: ["contact.name|contact.name_not_blank"],
  },
  { name: "name が 50 文字", contact: { name: "あ".repeat(50) }, expected: [] },
  {
    name: "name が 51 文字",
    contact: { name: "あ".repeat(51) },
    expected: ["contact.name|contact.name_max_len"],
  },
  {
    name: "email の形式が不正",
    contact: { email: "not-an-email" },
    expected: ["contact.email|string.email"],
  },

  // 任意項目: 空なら検証せず、入力があるときだけ形式を見る
  { name: "phone が空", contact: { phone: "" }, expected: [] },
  { name: "phone が 10 桁", contact: { phone: "0312345678" }, expected: [] },
  { name: "phone が 11 桁", contact: { phone: "09012345678" }, expected: [] },
  {
    name: "phone が 9 桁",
    contact: { phone: "031234567" },
    expected: ["contact.phone|contact.phone_format"],
  },
  {
    name: "phone が 0 始まりでない",
    contact: { phone: "1312345678" },
    expected: ["contact.phone|contact.phone_format"],
  },
  {
    name: "phone に数字以外",
    contact: { phone: "03-1234-5678" },
    expected: ["contact.phone|contact.phone_format"],
  },

  // enum
  {
    name: "category が UNSPECIFIED",
    contact: { category: Category.UNSPECIFIED },
    expected: ["contact.category|required"],
  },
  {
    name: "category が未定義の値",
    // 生成コードの型は未定義の値を許さないので、あえてキャストして送る
    contact: { category: 99 as Category },
    expected: ["contact.category|enum.defined_only"],
  },

  // message: 任意、最大 500 文字
  {
    name: "message が 500 文字",
    contact: { message: "x".repeat(500) },
    expected: [],
  },
  {
    name: "message が 501 文字",
    contact: { message: "x".repeat(501) },
    expected: ["contact.message|contact.message_max_len"],
  },

  // フィールド間のルール（CEL）。違反は特定の欄ではなく contact に付く
  {
    name: "OTHER で message が空",
    contact: { category: Category.OTHER, message: "" },
    expected: ["contact|contact.message_required_for_other"],
  },
  {
    name: "OTHER で message がある",
    contact: { category: Category.OTHER, message: "詳細" },
    expected: [],
  },
  {
    name: "OTHER 以外なら message は空でよい",
    contact: { category: Category.SUPPORT, message: "" },
    expected: [],
  },

  // 違反は 1 件で止まらず、まとめて返る
  {
    name: "複数の違反が同時に返る",
    contact: {
      name: "   ",
      email: "bad",
      phone: "123",
      category: Category.UNSPECIFIED,
    },
    expected: [
      "contact.category|required",
      "contact.email|string.email",
      "contact.name|contact.name_not_blank",
      "contact.phone|contact.phone_format",
    ],
  },
];

const invalidAll = cases.at(-1);

// ブラウザ（web が送信前に使う検証器）。サーバーなしで動く。
// サーバー側のテストも同じ expected と比べるので、ブラウザとサーバーが同じ結果になることの確認になる
describe("ブラウザの検証 (protovalidate)", () => {
  for (const c of cases) {
    test(c.name, () => {
      const req = create(CreateContactRequestSchema, {
        contact: validContact(c.contact),
      });
      expect(browserViolations(CreateContactRequestSchema, req)).toEqual(
        c.expected,
      );
    });
  }

  test("contact がない", () => {
    const req = create(CreateContactRequestSchema, {});
    expect(browserViolations(CreateContactRequestSchema, req)).toEqual([
      "contact|required",
    ]);
  });

  test("id が UUID でない", () => {
    expect(
      browserViolations(
        GetContactRequestSchema,
        create(GetContactRequestSchema, { id: "x" }),
      ),
    ).toEqual(["id|string.uuid"]);
  });
});

describeEach("バリデーション", (api) => {
  for (const c of cases) {
    test(c.name, async () => {
      const contact = validContact(c.contact);

      if (c.expected.length === 0) {
        await api.create(contact);
        return;
      }
      const err = await rejection(api.client.createContact({ contact }));
      expect(err.code).toBe(Code.InvalidArgument);
      expect(serverViolations(err)).toEqual(c.expected);
    });
  }

  test("Update でも Create と同じ違反になる", async () => {
    const created = await api.create();
    const err = await rejection(
      api.client.updateContact({
        id: created.id,
        contact: validContact(invalidAll?.contact),
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(serverViolations(err)).toEqual(invalidAll?.expected ?? []);
  });

  test("contact がない", async () => {
    const err = await rejection(api.client.createContact({}));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(serverViolations(err)).toEqual(["contact|required"]);
  });

  test("id が UUID でない（Get / Update / Delete）", async () => {
    const calls = [
      () => api.client.getContact({ id: "x" }),
      () => api.client.updateContact({ id: "x", contact: validContact() }),
      () => api.client.deleteContact({ id: "x" }),
    ];
    for (const call of calls) {
      const err = await rejection(call());
      expect(err.code).toBe(Code.InvalidArgument);
      expect(serverViolations(err)).toEqual(["id|string.uuid"]);
    }
  });
});
