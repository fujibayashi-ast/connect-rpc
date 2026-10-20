import { createServer } from "node:http";
import { ContactService } from "@connect-rpc/gen-ts/contact/v1/contact_pb.ts";
import { cors } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createValidateInterceptor } from "@connectrpc/validate";
import { accessLog } from "./accesslog.ts";
import { createContactService } from "./contact.ts";
import { maskErrors } from "./errormask.ts";

const port = Number(process.env.PORT ?? 8081);
// ブラウザから直接呼ぶため、web の dev サーバーのオリジンを許可する
const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// 検証ルールは proto に宣言してあり、interceptor が実行する。ハンドラには検証済みの値しか来ない。
// 先頭が一番外側。accessLog を一番外に置くと、検証エラーも想定外のエラー（internal に丸めたあと）もログに残る
const connectHandler = connectNodeAdapter({
  interceptors: [accessLog, maskErrors, createValidateInterceptor()],
  routes: (router) => {
    router.service(ContactService, createContactService());
  },
});

const server = createServer((req, res) => {
  // データは変わるので、GET の応答もブラウザに使い回させず、毎回サーバーに確認させる
  res.setHeader("Cache-Control", "no-cache");

  if (req.url === "/healthz") {
    res.end("ok");
    return;
  }

  if (req.headers.origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Expose-Headers",
      // X-Request-Id は web が付ける。応答でも読めるよう公開する
      [...cors.exposedHeaders, "X-Request-Id"].join(", "),
    );
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Methods",
        cors.allowedMethods.join(", "),
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        [...cors.allowedHeaders, "X-Request-Id"].join(", "),
      );
      // 値は Chrome の上限（2 時間）。ブラウザがプリフライトを POST のたびに送らなくなる
      res.setHeader("Access-Control-Max-Age", "7200");
      res.statusCode = 204;
      res.end();
      return;
    }
  }

  connectHandler(req, res);
});

server.listen(port, () => {
  console.log(`server-ts listening on :${port}`);
});
