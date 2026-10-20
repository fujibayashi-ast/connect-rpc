import { expect, test } from "bun:test";
import { describeEach } from "./helpers.ts";
import { allowedOrigin } from "./targets.ts";

const url = "/contact.v1.ContactService/CreateContact";

// ブラウザは Access-Control-Request-Headers を小文字・ソート済みで送る
function preflight(baseUrl: string, origin: string): Promise<Response> {
  return fetch(`${baseUrl}${url}`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "connect-protocol-version,content-type",
    },
  });
}

describeEach("CORS", ({ target }) => {
  test("許可したオリジンのプリフライトを通す", async () => {
    const res = await preflight(target.url, allowedOrigin);

    expect(res.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("プリフライトの結果をブラウザに使い回させる（Max-Age）", async () => {
    const res = await preflight(target.url, allowedOrigin);

    expect(res.headers.get("access-control-max-age")).toBe("7200");
  });

  test("別のオリジンには許可を返さない", async () => {
    // ステータスコードはサーバーごとに違うので見ない
    const res = await preflight(target.url, "http://evil.example");

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("実際のリクエストの応答にも許可オリジンが付く", async () => {
    const res = await fetch(
      `${target.url}/contact.v1.ContactService/ListContacts`,
      {
        method: "POST",
        headers: {
          Origin: allowedOrigin,
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
        body: "{}",
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
  });
});
