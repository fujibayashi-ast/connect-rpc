import {
  create,
  type DescMessage,
  type MessageShape,
} from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import {
  Category,
  type Contact,
  CreateContactRequestSchema,
  UpdateContactRequestSchema,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { categoryOptions } from "./category.ts";
import { contactClient } from "./client.ts";
import { ErrorAlert } from "./ErrorAlert.tsx";
import {
  type FormErrors,
  fromError,
  fromLocalViolations,
} from "./fieldErrors.ts";

// proto に書いた検証ルールをブラウザで実行する。サーバーと同じルールで、手書きの検証はない
const validator = createValidator();

type Props = {
  // 指定すると編集（全フィールドを置き換える）、なければ新規作成
  editing?: Contact;
  // 保存された連絡先（サーバーの応答）。呼び出し側が一覧に反映する
  onSaved: (saved: Contact) => void;
  onCancel: () => void;
};

export function ContactForm({ editing, onSaved, onCancel }: Props) {
  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [category, setCategory] = useState<Category>(
    editing?.category ?? Category.UNSPECIFIED,
  );
  const [message, setMessage] = useState(editing?.message ?? "");
  // サーバー側の検証を試すため、送信前の検証を止められるようにしてある
  const [skipLocal, setSkipLocal] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({ fields: {}, form: [] });
  const [submitting, setSubmitting] = useState(false);

  // 送信前の検証。スキップ指定か、問題がなければ undefined
  function localErrors<D extends DescMessage>(
    schema: D,
    req: MessageShape<D>,
  ): FormErrors | undefined {
    if (skipLocal) return undefined;
    const result = validator.validate(schema, req);
    return result.kind === "invalid"
      ? fromLocalViolations(result.violations)
      : undefined;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const contact = { name, email, phone, category, message };
    setSubmitting(true);
    try {
      let saved: Contact | undefined;
      if (editing) {
        const req = create(UpdateContactRequestSchema, {
          id: editing.id,
          contact,
        });
        const invalid = localErrors(UpdateContactRequestSchema, req);
        if (invalid) return setErrors(invalid);
        saved = (await contactClient.updateContact(req)).contact;
      } else {
        const req = create(CreateContactRequestSchema, { contact });
        const invalid = localErrors(CreateContactRequestSchema, req);
        if (invalid) return setErrors(invalid);
        saved = (await contactClient.createContact(req)).contact;
      }
      if (saved) onSaved(saved);
    } catch (err) {
      setErrors(fromError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate aria-busy={submitting}>
        <CardHeader>
          <CardTitle>{editing ? "連絡先を編集" : "連絡先を追加"}</CardTitle>
        </CardHeader>
        <CardContent className="mt-6 space-y-4">
          {errors.form.map((text) => (
            <ErrorAlert key={text}>{text}</ErrorAlert>
          ))}
          <Field
            id="name"
            label="名前（必須）"
            error={errors.fields.name}
            required
          >
            {(a) => (
              <Input
                {...a}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field
            id="email"
            label="メールアドレス（必須）"
            error={errors.fields.email}
            required
          >
            {(a) => (
              <Input
                {...a}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field
            id="phone"
            label="電話番号（任意）"
            error={errors.fields.phone}
          >
            {(a) => (
              <Input
                {...a}
                value={phone}
                placeholder="0312345678"
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field
            id="category"
            label="カテゴリ（必須）"
            error={errors.fields.category}
            required
          >
            {(a) => (
              <NativeSelect
                {...a}
                value={category}
                onChange={(e) =>
                  setCategory(Number(e.target.value) as Category)
                }
              >
                {categoryOptions.map((c) => (
                  <NativeSelectOption key={c.value} value={c.value}>
                    {c.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id="message"
            label="内容（任意。カテゴリが「その他」のときは必須）"
            error={errors.fields.message}
          >
            {(a) => (
              <Textarea
                {...a}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            )}
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox
              id="skipLocal"
              checked={skipLocal}
              onCheckedChange={(v) => setSkipLocal(v === true)}
            />
            <Label htmlFor="skipLocal" className="font-normal">
              送信前の検証をスキップ（サーバーの検証を試す）
            </Label>
          </div>
        </CardContent>
        <CardFooter className="mt-6 gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "送信中…" : editing ? "更新" : "追加"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

type ControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-required": boolean;
  "aria-describedby": string | undefined;
};

// ラベル・エラー文と、入力欄の aria 属性（エラーとの関連づけ）をまとめて扱う
function Field(props: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: (control: ControlProps) => ReactNode;
}) {
  const errorId = `${props.id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children({
        id: props.id,
        "aria-invalid": Boolean(props.error),
        "aria-required": Boolean(props.required),
        "aria-describedby": props.error ? errorId : undefined,
      })}
      {props.error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      )}
    </div>
  );
}
