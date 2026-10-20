import { afterEach, beforeAll, describe } from "bun:test";
import type {
  DescMessage,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import { pathToString } from "@bufbuild/protobuf/reflect";
import { createValidator } from "@bufbuild/protovalidate";
import { ViolationsSchema } from "@bufbuild/protovalidate/gen/buf/validate/validate_pb.js";
import {
  Category,
  type Contact,
  type ContactSchema,
  ContactService,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { assertReachable, type Target, targets } from "./targets.ts";

export type ContactInit = MessageInitShape<typeof ContactSchema>;

export type Api = {
  target: Target;
  client: ReturnType<typeof createClient<typeof ContactService>>;
  // 作成した連絡先を記録する。afterEach で消すので、テストは後片付けを書かなくてよい
  create: (overrides?: ContactInit) => Promise<Contact>;
};

// 同じテストを、起動中の Go と TS のサーバーそれぞれに流す
export function describeEach(title: string, fn: (api: Api) => void): void {
  for (const target of targets) {
    describe(`${title} [${target.name}]`, () => {
      const client = createClient(
        ContactService,
        createConnectTransport({ baseUrl: target.url }),
      );
      const created: string[] = [];
      const api: Api = {
        target,
        client,
        create: async (overrides) => {
          const res = await client.createContact({
            contact: validContact(overrides),
          });
          const contact = res.contact;
          if (!contact) throw new Error("レスポンスに contact がない");
          created.push(contact.id);
          return contact;
        },
      };

      beforeAll(() => assertReachable(target));
      afterEach(async () => {
        for (const id of created.splice(0)) {
          // テストの中で削除済みのものは NotFound になるので無視する
          await client.deleteContact({ id }).catch(() => undefined);
        }
      });

      fn(api);
    });
  }
}

// 全ページをたどって一覧を集める。ページの大きさは、テストごとに他のデータが何件あっても
// 1 ページに収まらない可能性があるので、一覧を調べるテストはこれを使う
export async function listAll(
  client: Api["client"],
  pageSize = 100,
): Promise<Contact[]> {
  const all: Contact[] = [];
  let pageToken = "";
  do {
    const res = await client.listContacts({ pageSize, pageToken });
    all.push(...res.contacts);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return all;
}

// サーバーは状態を持つので、テストごとに別の email を使う
export function uniqueEmail(): string {
  return `test-${crypto.randomUUID()}@example.com`;
}

export function validContact(overrides: ContactInit = {}): ContactInit {
  return {
    name: "山田太郎",
    email: uniqueEmail(),
    phone: "",
    category: Category.GENERAL,
    message: "",
    ...overrides,
  };
}

// 失敗するはずの呼び出しのエラーを受け取る
export async function rejection(
  promise: Promise<unknown>,
): Promise<ConnectError> {
  try {
    await promise;
  } catch (err) {
    return ConnectError.from(err);
  }
  throw new Error("呼び出しが成功した。失敗するはずだった");
}

// 違反は「フィールドのパス|ruleId」の文字列にそろえて比べる。
// メッセージの文面は見ない（標準ルールの文面は実装ごとに違いうる）
function key(path: string, ruleId: string | undefined): string {
  return `${path}|${ruleId ?? ""}`;
}

// サーバーのエラー details（buf.validate.Violations）から違反を取り出す
export function serverViolations(err: ConnectError): string[] {
  return err
    .findDetails(ViolationsSchema)
    .flatMap((d) =>
      d.violations.map((v) =>
        key(
          (v.field?.elements ?? []).map((el) => el.fieldName ?? "").join("."),
          v.ruleId,
        ),
      ),
    )
    .sort();
}

// web が送信前に使うのと同じ検証器の結果
const validator = createValidator();
export function browserViolations<D extends DescMessage>(
  schema: D,
  message: MessageShape<D>,
): string[] {
  const result = validator.validate(schema, message);
  if (result.kind === "valid") return [];
  if (result.kind === "error") throw result.error;
  return result.violations
    .map((v) => key(pathToString(v.field), v.ruleId))
    .sort();
}

// クライアントを通さず HTTP をそのまま送る。GET やヘッダーを細かく指定したいテスト用
// （クライアントの timeoutMs: 0 は「期限なし」として扱われ、ヘッダーが付かない。期限 0 のヘッダーを送るには生の fetch が要る）
const procedure = (method: string) => `/contact.v1.ContactService/${method}`;

export function rawPost(
  target: Target,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${target.url}${procedure(method)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// Connect の GET。リクエストはクエリに入れる
export function rawGet(
  target: Target,
  method: string,
  message: unknown,
): Promise<Response> {
  const query = new URLSearchParams({
    connect: "v1",
    encoding: "json",
    message: JSON.stringify(message),
  });
  return fetch(`${target.url}${procedure(method)}?${query}`);
}
