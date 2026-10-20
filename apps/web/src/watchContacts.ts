import type { WatchContactsResponse } from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { ConnectError } from "@connectrpc/connect";
import { contactClient } from "./client.ts";

const RECONNECT_MS = 2000;

// 連絡先の変更を監視し続ける。切れたら 2 秒後に再接続する（つながり直すと snapshot が届くので、状態は自然に直る）。
// signal が中止されたら終わる。onError には、切れているあいだのメッセージを渡し、つながると undefined を渡す
export async function watchContacts(
  signal: AbortSignal,
  onEvent: (res: WatchContactsResponse) => void,
  onError: (message: string | undefined) => void,
): Promise<void> {
  while (!signal.aborted) {
    try {
      // 既定の期限（10 秒）で切れないよう、この呼び出しだけ timeoutMs: 0（期限なし）にする
      const stream = contactClient.watchContacts({}, { signal, timeoutMs: 0 });
      for await (const res of stream) {
        onError(undefined);
        onEvent(res);
      }
    } catch (err) {
      if (signal.aborted) return;
      onError(
        `接続が切れました。再接続します（${ConnectError.from(err).message}）`,
      );
    }
    await sleep(RECONNECT_MS, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
