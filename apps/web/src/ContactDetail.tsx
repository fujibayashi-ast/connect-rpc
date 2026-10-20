import type { Contact } from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { Code, ConnectError } from "@connectrpc/connect";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { categoryLabels } from "./category.ts";
import { contactClient } from "./client.ts";
import { ErrorAlert } from "./ErrorAlert.tsx";

type Props = {
  // 一覧にある連絡先。変わったら（別のタブでの更新など）取得し直す
  summary: Contact;
  onClose: () => void;
};

type State =
  | { status: "loading" }
  | { status: "loaded"; contact: Contact }
  | { status: "error"; message: string };

// 1 件を GetContact で取得して表示する。GetContact は NO_SIDE_EFFECTS なので、
// client の useHttpGet により GET で送られる（ブラウザの開発者ツールで確認できる）
export function ContactDetail({ summary, onClose }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const abort = new AbortController();
    setState({ status: "loading" });
    contactClient
      .getContact({ id: summary.id }, { signal: abort.signal })
      .then((res) => {
        if (res.contact) setState({ status: "loaded", contact: res.contact });
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        const e = ConnectError.from(err);
        setState({
          status: "error",
          message:
            e.code === Code.NotFound
              ? "この連絡先は削除されました"
              : e.rawMessage,
        });
      });
    return () => abort.abort();
  }, [summary]);

  return (
    <Card aria-label="連絡先の詳細" aria-busy={state.status === "loading"}>
      <CardHeader>
        <CardTitle>詳細</CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === "loading" && (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        )}
        {state.status === "error" && <ErrorAlert>{state.message}</ErrorAlert>}
        {state.status === "loaded" && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">名前</dt>
            <dd>{state.contact.name}</dd>
            <dt className="text-muted-foreground">メールアドレス</dt>
            <dd className="break-all">{state.contact.email}</dd>
            <dt className="text-muted-foreground">電話番号</dt>
            <dd className="tabular-nums">{state.contact.phone || "-"}</dd>
            <dt className="text-muted-foreground">カテゴリ</dt>
            <dd>{categoryLabels[state.contact.category] ?? "-"}</dd>
            <dt className="text-muted-foreground">内容</dt>
            <dd className="text-pretty whitespace-pre-wrap">
              {state.contact.message || "-"}
            </dd>
          </dl>
        )}
      </CardContent>
      <CardFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          閉じる
        </Button>
      </CardFooter>
    </Card>
  );
}
