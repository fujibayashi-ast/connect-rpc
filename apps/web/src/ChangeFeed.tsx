import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { describeEvent } from "./changeFeed.ts";
import { ErrorAlert } from "./ErrorAlert.tsx";
import { watchContacts } from "./watchContacts.ts";

type Entry = { id: number; time: string; text: string };

const MAX_ENTRIES = 10;

type Props = {
  // 一覧を取り直す。別のタブの変更を一覧に入れたいときに押す
  onReload: () => void;
};

// WatchContacts で受け取った変更を、新しい順に並べて見せる。一覧そのものは作らない
// （一覧は ListContacts と自分の操作の応答で作る）
export function ChangeFeed({ onReload }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [connectionError, setConnectionError] = useState<string>();
  const nextId = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    void watchContacts(
      abort.signal,
      (res) => {
        const text = describeEvent(res);
        if (!text) return;
        const entry = {
          id: nextId.current++,
          time: new Date().toLocaleTimeString("ja-JP"),
          text,
        };
        setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
      },
      setConnectionError,
    );
    return () => abort.abort();
  }, []);

  return (
    <Card aria-label="サーバーの変更">
      <CardHeader>
        <CardTitle>サーバーの変更</CardTitle>
        <CardDescription className="text-pretty">
          このタブの操作も含みます。別のタブの変更は、再読み込みで一覧に入ります
        </CardDescription>
        <CardAction>
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            一覧を再読み込み
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {connectionError && <ErrorAlert>{connectionError}</ErrorAlert>}
        {/* 変更が届くたびに読み上げられるよう、リストを live region にしてある */}
        <ul aria-live="polite" className="space-y-1 text-sm">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="mr-2 text-muted-foreground tabular-nums">
                {e.time}
              </span>
              {e.text}
            </li>
          ))}
        </ul>
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">まだ変更はありません</p>
        )}
      </CardContent>
    </Card>
  );
}
