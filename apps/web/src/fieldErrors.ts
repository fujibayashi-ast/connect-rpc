import { pathToString } from "@bufbuild/protobuf/reflect";
import type { Violation } from "@bufbuild/protovalidate";
import {
  type Violation as ViolationMessage,
  ViolationsSchema,
} from "@bufbuild/protovalidate/gen/buf/validate/validate_pb.js";
import { ConnectError } from "@connectrpc/connect";

// 画面に出すエラー。fields は入力欄ごと、form は特定の欄に紐づかないもの
export type FormErrors = {
  fields: Record<string, string>;
  form: string[];
};

type Normalized = { field: string; ruleId: string; message: string };

// ブラウザでの検証結果（protovalidate）とサーバーのエラー詳細を同じ形にそろえる。
// 重複 email のようなサーバーだけの検証も、同じ Violations で届く
export function fromLocalViolations(violations: Violation[]): FormErrors {
  return toFormErrors(
    violations.map((v) => ({
      field: pathToString(v.field),
      ruleId: v.ruleId,
      message: v.message,
    })),
  );
}

export function fromError(err: unknown): FormErrors {
  const e = ConnectError.from(err);
  const violations = e
    .findDetails(ViolationsSchema)
    .flatMap((d) => d.violations.map(fromMessage));
  if (violations.length > 0) return toFormErrors(violations);
  return { fields: {}, form: [e.rawMessage] };
}

function fromMessage(v: ViolationMessage): Normalized {
  return {
    field: (v.field?.elements ?? []).map((el) => el.fieldName ?? "").join("."),
    ruleId: v.ruleId ?? "",
    message: v.message ?? "",
  };
}

function toFormErrors(violations: Normalized[]): FormErrors {
  const errors: FormErrors = { fields: {}, form: [] };
  for (const v of violations) {
    // リクエストは { contact: {...} } の形。欄の名前は contact. を除いたもの
    const field = v.field.replace(/^contact\./, "");
    const text = describe(v);
    if (field === "" || field === "contact" || field === "id") {
      errors.form.push(text);
    } else if (!errors.fields[field]) {
      errors.fields[field] = text;
    }
  }
  return errors;
}

// 標準ルールのメッセージは英語で、proto からは差し替えられない。だから ruleId から日本語にする。
// 数値を含むルールなど、proto の独自 CEL は日本語のメッセージを持っているので、そのまま使う
// （値を表に複製すると proto とずれるため、数値を含むものはここに書かない）
const messages: Record<string, string> = {
  required: "必須項目です",
  "string.email": "メールアドレスの形式で入力してください",
  "enum.defined_only": "選択肢から選んでください",
};

function describe(v: Normalized): string {
  return messages[v.ruleId] ?? v.message;
}
