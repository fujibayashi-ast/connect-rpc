import { describe, expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { ViolationsSchema } from "@bufbuild/protovalidate/gen/buf/validate/validate_pb.js";
import {
  Category,
  CreateContactRequestSchema,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { Code, ConnectError } from "@connectrpc/connect";
import { fromError, fromLocalViolations } from "./fieldErrors.ts";

const validator = createValidator();

// 本物の検証器の結果を使う。違反の形をテスト側で組み立てない
function localErrors(
  contact: Parameters<typeof create<typeof CreateContactRequestSchema>>[1],
) {
  const req = create(CreateContactRequestSchema, contact);
  const result = validator.validate(CreateContactRequestSchema, req);
  if (result.kind !== "invalid") throw new Error("無効な入力のはずが通った");
  return fromLocalViolations(result.violations);
}

const valid = {
  name: "山田太郎",
  email: "taro@example.com",
  phone: "",
  category: Category.GENERAL,
  message: "",
};

// サーバーが返す形（Violations を details に載せた ConnectError）
function serverError(
  code: Code,
  message: string,
  violations: { path: string[]; ruleId: string; message: string }[],
): ConnectError {
  return new ConnectError(message, code, undefined, [
    {
      desc: ViolationsSchema,
      value: {
        violations: violations.map((v) => ({
          field: { elements: v.path.map((fieldName) => ({ fieldName })) },
          ruleId: v.ruleId,
          message: v.message,
        })),
      },
    },
  ]);
}

describe("fromLocalViolations（ブラウザの検証結果）", () => {
  test("違反が入力欄ごとのエラーになる。標準ルールは日本語になる", () => {
    const errors = localErrors({
      contact: {
        name: "   ",
        email: "bad",
        phone: "123",
        category: Category.UNSPECIFIED,
      },
    });

    expect(errors).toEqual({
      fields: {
        // 独自 CEL は proto に書いた日本語のメッセージがそのまま出る
        name: "空白だけの名前は使えません",
        email: "メールアドレスの形式で入力してください",
        phone: "0 から始まる 10〜11 桁の数字で入力してください",
        category: "必須項目です",
      },
      form: [],
    });
  });

  test("同じ max_len でも欄ごとの文言になる", () => {
    const name = localErrors({
      contact: { ...valid, name: "あ".repeat(51) },
    });
    const message = localErrors({
      contact: { ...valid, message: "x".repeat(501) },
    });

    expect(name.fields).toEqual({ name: "50 文字以内で入力してください" });
    expect(message.fields).toEqual({
      message: "500 文字以内で入力してください",
    });
  });

  test("特定の欄に紐づかない違反は form に入る", () => {
    const errors = localErrors({
      contact: { ...valid, category: Category.OTHER, message: "" },
    });

    expect(errors.fields).toEqual({});
    expect(errors.form).toEqual(["カテゴリが「その他」のときは内容が必須です"]);
  });

  test("contact がないときは form に入る", () => {
    const result = validator.validate(
      CreateContactRequestSchema,
      create(CreateContactRequestSchema, {}),
    );
    if (result.kind !== "invalid") throw new Error("無効な入力のはずが通った");

    const errors = fromLocalViolations(result.violations);

    expect(errors.fields).toEqual({});
    expect(errors.form).toEqual(["必須項目です"]);
  });
});

describe("fromError（サーバーのエラー）", () => {
  test("重複 email は email 欄のエラーになる", () => {
    const err = serverError(Code.AlreadyExists, "duplicate", [
      {
        path: ["contact", "email"],
        ruleId: "contact.email_unique",
        message: "このメールアドレスは既に登録されています",
      },
    ]);

    expect(fromError(err)).toEqual({
      // 辞書に無い ruleId は、サーバーのメッセージにフォールバックする
      fields: { email: "このメールアドレスは既に登録されています" },
      form: [],
    });
  });

  test("検証エラーはブラウザの検証と同じ文言になる", () => {
    const err = serverError(Code.InvalidArgument, "validation errors", [
      {
        path: ["contact", "email"],
        ruleId: "string.email",
        message: "must be a valid email address",
      },
      {
        path: ["contact", "name"],
        ruleId: "contact.name_max_len",
        message: "50 文字以内で入力してください",
      },
    ]);

    // 標準ルールは ruleId から訳し、独自の CEL は proto のメッセージがそのまま出る
    expect(fromError(err).fields).toEqual({
      email: "メールアドレスの形式で入力してください",
      name: "50 文字以内で入力してください",
    });
  });

  test("同じ欄に違反が複数あれば最初の 1 件だけ残す", () => {
    const err = serverError(Code.InvalidArgument, "validation errors", [
      {
        path: ["contact", "email"],
        ruleId: "required",
        message: "value is required",
      },
      {
        path: ["contact", "email"],
        ruleId: "string.email",
        message: "must be a valid email address",
      },
    ]);

    expect(fromError(err).fields).toEqual({ email: "必須項目です" });
  });

  test("id や contact 自体の違反は form に入る", () => {
    const err = serverError(Code.InvalidArgument, "validation errors", [
      { path: ["id"], ruleId: "string.uuid", message: "must be a valid UUID" },
    ]);

    expect(fromError(err)).toEqual({
      fields: {},
      form: ["must be a valid UUID"],
    });
  });

  test("details のないエラーは form にメッセージを入れる", () => {
    const err = new ConnectError("contact not found: x", Code.NotFound);

    expect(fromError(err)).toEqual({
      fields: {},
      form: ["contact not found: x"],
    });
  });

  test("ConnectError 以外の例外も form に入る", () => {
    expect(fromError(new Error("boom"))).toEqual({
      fields: {},
      form: ["boom"],
    });
  });
});
