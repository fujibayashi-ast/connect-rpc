import type { Interceptor } from "@connectrpc/connect";

// 呼び出しごとに識別子を付ける。サーバーのアクセスログにも同じ値が出るので、
// 画面の操作とサーバーのログを突き合わせられる（形式は apps/server-*/ の accessLog と同じ [A-Za-z0-9-]{1,64}）
export const requestId: Interceptor = (next) => (req) => {
  req.header.set("x-request-id", crypto.randomUUID());
  return next(req);
};
