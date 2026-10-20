import { EventEmitter, on } from "node:events";
import { create } from "@bufbuild/protobuf";
import { FieldDescriptorProto_Type } from "@bufbuild/protobuf/wkt";
import { ViolationsSchema } from "@bufbuild/protovalidate/gen/buf/validate/validate_pb.js";
import {
  ChangeType,
  type Contact,
  type ContactChange,
  ContactChangeSchema,
  ContactSchema,
  type ContactService,
} from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

// contact.proto のフィールド番号。重複エラーの field path を組み立てるのに使う
const CREATE_REQUEST_CONTACT_FIELD = 1;
const UPDATE_REQUEST_CONTACT_FIELD = 2;
const CONTACT_EMAIL_FIELD = 3;

const DEFAULT_PAGE_SIZE = 50;

// page_token は通し番号を base64url にしただけのもの。クライアントには中身を意味のない文字列として扱わせる
function encodePageToken(seq: number): string {
  return Buffer.from(String(seq)).toString("base64url");
}

// 空のトークンは先頭から（0）。壊れたトークンは invalid_argument
function decodePageToken(token: string): number {
  if (token === "") return 0;
  const text = Buffer.from(token, "base64url").toString();
  const seq = Number(text);
  // base64url に戻して一致するものだけを受け付ける（余計な文字を含む壊れたトークンを弾く）
  if (
    !Number.isSafeInteger(seq) ||
    seq <= 0 ||
    encodePageToken(seq) !== token
  ) {
    throw new ConnectError("invalid page_token", Code.InvalidArgument);
  }
  return seq;
}

// インメモリで連絡先を持つ。永続化はしない。登録順を保つ。
// hub は変更の通知先。WatchContacts の購読者がここから受け取る（テストでは差し替える）
export function createContactService(
  hub = new EventEmitter(),
): ServiceImpl<typeof ContactService> {
  // 購読者が 10 を超えても警告を出さない
  hub.setMaxListeners(0);
  const contacts: Contact[] = [];
  // 登録の通し番号。page_token の中身になる。削除しても番号は詰めないので、
  // ページをめくる間に削除や追加があっても、飛んだり重複したりしない
  const seqs = new Map<string, number>();
  let nextSeq = 0;

  const publish = (type: ChangeType, contact: Contact) => {
    hub.emit("change", create(ContactChangeSchema, { type, contact }));
  };

  const indexOf = (id: string) => contacts.findIndex((c) => c.id === id);

  // 大文字小文字を区別せずに比較する。exceptId の連絡先は除く
  const emailTaken = (email: string, exceptId: string) =>
    contacts.some(
      (c) => c.id !== exceptId && c.email.toLowerCase() === email.toLowerCase(),
    );

  const notFound = (id: string) =>
    new ConnectError(`contact not found: ${id}`, Code.NotFound);

  return {
    createContact(req, ctx) {
      // 期限は Connect-Timeout-Ms で届く。切れていれば何もせずに投げる（期限切れの理由は deadline_exceeded）
      ctx.signal.throwIfAborted();
      // required を宣言してあるので、検証済みなら contact は必ずある
      const input = req.contact;
      if (!input) throw new ConnectError("contact is required", Code.Internal);
      if (emailTaken(input.email, "")) {
        throw duplicateEmailError(CREATE_REQUEST_CONTACT_FIELD);
      }
      const contact = create(ContactSchema, {
        ...input,
        id: crypto.randomUUID(),
      });
      contacts.push(contact);
      seqs.set(contact.id, ++nextSeq);
      publish(ChangeType.CREATED, contact);
      return { contact };
    },

    getContact(req, ctx) {
      ctx.signal.throwIfAborted();
      const i = indexOf(req.id);
      if (i < 0) throw notFound(req.id);
      return { contact: contacts[i] };
    },

    listContacts(req, ctx) {
      ctx.signal.throwIfAborted();
      const after = decodePageToken(req.pageToken);
      const size = req.pageSize || DEFAULT_PAGE_SIZE;
      const seqOf = (c: Contact) => seqs.get(c.id) ?? 0;

      const rest = contacts.filter((c) => seqOf(c) > after);
      const page = rest.slice(0, size);
      // まだ残りがあれば、最後に返した連絡先の番号が次のページの起点になる
      const last = page.at(-1);
      const nextPageToken =
        rest.length > size && last ? encodePageToken(seqOf(last)) : "";
      return { contacts: page, nextPageToken };
    },

    updateContact(req, ctx) {
      ctx.signal.throwIfAborted();
      const input = req.contact;
      if (!input) throw new ConnectError("contact is required", Code.Internal);
      const i = indexOf(req.id);
      if (i < 0) throw notFound(req.id);
      // 自分自身の email は重複とみなさない
      if (emailTaken(input.email, req.id)) {
        throw duplicateEmailError(UPDATE_REQUEST_CONTACT_FIELD);
      }
      const contact = create(ContactSchema, { ...input, id: req.id });
      contacts[i] = contact;
      publish(ChangeType.UPDATED, contact);
      return { contact };
    },

    deleteContact(req, ctx) {
      ctx.signal.throwIfAborted();
      const i = indexOf(req.id);
      if (i < 0) throw notFound(req.id);
      const deleted = contacts[i];
      contacts.splice(i, 1);
      seqs.delete(req.id);
      if (deleted) publish(ChangeType.DELETED, deleted);
      return {};
    },

    // 接続した直後に現在の一覧（snapshot）を 1 回送り、その後は変更を送り続ける。
    // クライアントが切断・中止すると signal が中止され、購読は外れる
    async *watchContacts(_req, ctx) {
      ctx.signal.throwIfAborted();
      // 先に購読を始めてから一覧を読む。間に await がないので、一覧と最初の変更の間に取りこぼしが出ない
      const changes = on(hub, "change", { signal: ctx.signal });
      try {
        yield {
          event: { case: "snapshot", value: { contacts: [...contacts] } },
        };
        for await (const [change] of changes) {
          yield { event: { case: "change", value: change as ContactChange } };
        }
      } catch (err) {
        // events.on は中止を AbortError で投げるので、期限切れという理由（deadline_exceeded）が失われる。
        // 理由が ConnectError ならそれを投げ直す
        if (ctx.signal.aborted && ctx.signal.reason instanceof ConnectError) {
          throw ctx.signal.reason;
        }
        throw err;
      } finally {
        // snapshot を送った直後に読むのをやめられた場合も、購読を確実に外す
        await changes.return?.();
      }
    },
  };
}

// 検証エラーと同じ buf.validate.Violations を details に載せる。
// クライアントは検証エラーと同じ処理で email 欄に表示できる
function duplicateEmailError(contactField: number): ConnectError {
  const message = "このメールアドレスは既に登録されています";
  return new ConnectError(message, Code.AlreadyExists, undefined, [
    {
      desc: ViolationsSchema,
      value: {
        violations: [
          {
            field: {
              elements: [
                {
                  fieldName: "contact",
                  fieldNumber: contactField,
                  fieldType: FieldDescriptorProto_Type.MESSAGE,
                },
                {
                  fieldName: "email",
                  fieldNumber: CONTACT_EMAIL_FIELD,
                  fieldType: FieldDescriptorProto_Type.STRING,
                },
              ],
            },
            ruleId: "contact.email_unique",
            message,
          },
        ],
      },
    },
  ]);
}
