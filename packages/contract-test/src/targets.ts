export type Target = { name: string; url: string };

// 8081 が別のプロセスで塞がっているときは TS_URL=http://localhost:8082 のように上書きする
export const targets: Target[] = [
  { name: "go", url: process.env.GO_URL ?? "http://localhost:8080" },
  { name: "ts", url: process.env.TS_URL ?? "http://localhost:8081" },
];

// CORS を許可するオリジン。サーバーの CORS_ORIGIN の既定値と同じ
export const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// サーバーが起動していなければ、テストの失敗より先に起動方法を伝える
export async function assertReachable(target: Target): Promise<void> {
  try {
    const res = await fetch(`${target.url}/healthz`);
    if (res.ok) return;
  } catch {
    // 下で同じメッセージを投げる
  }
  throw new Error(
    `${target.name} のサーバー (${target.url}) につながりません。` +
      "`docker compose up -d --build --wait` で起動してください",
  );
}
