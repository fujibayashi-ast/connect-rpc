import type { Contact } from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { ConnectError } from "@connectrpc/connect";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { ChangeFeed } from "./ChangeFeed.tsx";
import { ConfirmDelete } from "./ConfirmDelete.tsx";
import { ContactDetail } from "./ContactDetail.tsx";
import { ContactForm } from "./ContactForm.tsx";
import { categoryLabels } from "./category.ts";
import { contactClient } from "./client.ts";
import { ErrorAlert } from "./ErrorAlert.tsx";
import { listAllContacts } from "./listAllContacts.ts";

// undefined: フォームを閉じている / null: 新規作成 / Contact: 編集
type FormState = undefined | null | Contact;

export function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  // 最初の取得が終わるまでは「連絡先がありません」を出さない
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>(undefined);
  // 詳細を開いている連絡先の id。一覧から消えた（削除された）ら詳細も閉じる
  const [detailId, setDetailId] = useState<string>();
  const detail = contacts.find((c) => c.id === detailId);
  // 一覧の取得と、操作（削除など）のエラー
  const [loadError, setLoadError] = useState<string>();
  const [error, setError] = useState<string>();

  // 一覧は ListContacts で作る。自分の追加・更新・削除は、応答で一覧に反映する。
  // 別のタブの変更は ChangeFeed に通知が出て、再読み込みで一覧に入る
  const loadAbort = useRef<AbortController>(undefined);
  const load = useCallback(async () => {
    loadAbort.current?.abort();
    const abort = new AbortController();
    loadAbort.current = abort;
    try {
      setContacts(await listAllContacts(abort.signal));
      setLoaded(true);
      setLoadError(undefined);
    } catch (err) {
      if (!abort.signal.aborted) setLoadError(ConnectError.from(err).message);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => loadAbort.current?.abort();
  }, [load]);

  // 保存された連絡先を一覧に反映する（あれば差し替え、なければ末尾に足す）
  function upsert(saved: Contact) {
    setContacts((prev) =>
      prev.some((c) => c.id === saved.id)
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [...prev, saved],
    );
  }

  async function remove(id: string) {
    try {
      await contactClient.deleteContact({ id });
      setContacts((prev) => prev.filter((c) => c.id !== id));
      setError(undefined);
    } catch (err) {
      setError(ConnectError.from(err).message);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-balance">連絡先</h1>
        {form === undefined && (
          <Button type="button" onClick={() => setForm(null)}>
            追加
          </Button>
        )}
      </div>
      {form !== undefined && (
        <ContactForm
          // 編集対象が変わったら入力値を初期化する
          key={form?.id ?? "new"}
          editing={form ?? undefined}
          onCancel={() => setForm(undefined)}
          onSaved={(saved) => {
            upsert(saved);
            setForm(undefined);
          }}
        />
      )}
      {detail && (
        <ContactDetail
          summary={detail}
          onClose={() => setDetailId(undefined)}
        />
      )}
      {[loadError, error].map(
        (message) =>
          message && <ErrorAlert key={message}>{message}</ErrorAlert>,
      )}
      <Card className="py-0">
        <CardContent className="px-0">
          {loaded && contacts.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                連絡先がまだありません
              </p>
              {form === undefined && (
                <Button type="button" onClick={() => setForm(null)}>
                  最初の連絡先を追加
                </Button>
              )}
            </div>
          )}
          <ul className="divide-y">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto min-w-0 shrink justify-start p-0 font-semibold text-foreground"
                      onClick={() => setDetailId(c.id)}
                    >
                      <span className="truncate">{c.name}</span>
                    </Button>
                    <Badge variant="secondary">
                      {categoryLabels[c.category] ?? "-"}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {c.email}
                    {c.phone && (
                      <span className="tabular-nums"> / {c.phone}</span>
                    )}
                  </p>
                  {c.message && (
                    <p className="line-clamp-2 text-sm text-pretty">
                      {c.message}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setForm(c)}
                  >
                    編集
                    <span className="sr-only">: {c.name}</span>
                  </Button>
                  <ConfirmDelete name={c.name} onConfirm={() => remove(c.id)} />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <ChangeFeed onReload={load} />
    </main>
  );
}
