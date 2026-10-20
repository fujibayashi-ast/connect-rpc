import { expect, test } from "bun:test";
import { describeEach, rawPost } from "./helpers.ts";
import { allowedOrigin } from "./targets.ts";

const UUID = /^[0-9a-f-]{36}$/;

describeEach("request-id", ({ target }) => {
  const call = (headers: Record<string, string> = {}) =>
    rawPost(target, "ListContacts", {}, headers);

  test("クライアントの X-Request-Id が、そのまま応答のヘッダーで返る", async () => {
    const res = await call({ "X-Request-Id": "contract-test-123" });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("contract-test-123");
  });

  test("付けなければ、サーバーが採番して返す", async () => {
    const res = await call();

    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  test("形式が合わない値は使わず、採番し直す", async () => {
    for (const bad of ["a b", "x=y", "a".repeat(65)]) {
      const res = await call({ "X-Request-Id": bad });

      expect(res.headers.get("x-request-id")).toMatch(UUID);
    }
  });

  test("エラーの応答にも付く（検証エラー）", async () => {
    const res = await rawPost(
      target,
      "ListContacts",
      { pageSize: 101 },
      { "X-Request-Id": "contract-test-err" },
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe("contract-test-err");
  });

  test("プリフライトで X-Request-Id の送信が許可される", async () => {
    const res = await fetch(
      `${target.url}/contact.v1.ContactService/ListContacts`,
      {
        method: "OPTIONS",
        headers: {
          Origin: allowedOrigin,
          "Access-Control-Request-Method": "POST",
          // ブラウザは小文字・ソート済みで送る
          "Access-Control-Request-Headers":
            "connect-protocol-version,content-type,x-request-id",
        },
      },
    );

    expect(res.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(
      res.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).toContain("x-request-id");
  });

  test("別のオリジンのページからも応答の X-Request-Id を読める（Expose-Headers）", async () => {
    const res = await call({ Origin: allowedOrigin });

    expect(
      res.headers.get("access-control-expose-headers")?.toLowerCase(),
    ).toContain("x-request-id");
  });
});
