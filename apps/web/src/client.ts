import { ContactService } from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { requestId } from "./requestId.ts";

// 接続先は環境変数だけで切り替える。クライアントのコードは Go / TS どちらのサーバーでも同じ
const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export const contactClient = createClient(
  ContactService,
  createConnectTransport({
    baseUrl,
    // proto で NO_SIDE_EFFECTS を付けた RPC（一覧の取得など）を GET で呼ぶ
    useHttpGet: true,
    // 応答が来なくても画面が固まらないよう、期限を付ける。サーバーには Connect-Timeout-Ms で伝わる
    defaultTimeoutMs: 10_000,
    // 呼び出しごとに x-request-id を付ける（サーバーのログと突き合わせられる）
    interceptors: [requestId],
  }),
);
