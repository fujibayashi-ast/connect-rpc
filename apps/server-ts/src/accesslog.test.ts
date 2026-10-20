import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";
import { accessLog } from "./accesslog.ts";

type Req = Parameters<ReturnType<Interceptor>>[0];
type Res = Awaited<ReturnType<ReturnType<Interceptor>>>;
const reqWith = (requestId?: string) =>
  ({
    service: { typeName: "test.v1.Svc" },
    method: { name: "Do" },
    header: new Headers(
      requestId === undefined ? {} : { "x-request-id": requestId },
    ),
  }) as unknown as Req;
const req = reqWith();

let spy: ReturnType<typeof spyOn<Console, "log">>;
beforeEach(() => {
  spy = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => spy.mockRestore());

const lines = () => spy.mock.calls.map((args) => String(args[0]));

async function* numbers(throwAfter?: Error) {
  yield 1;
  yield 2;
  if (throwAfter) throw throwAfter;
}
const unaryRes = () => ({ header: new Headers() }) as unknown as Res;
const streamRes = (messages: AsyncIterable<number>) =>
  ({
    stream: true,
    message: messages,
    header: new Headers(),
  }) as unknown as Res;
const messagesOf = (res: Res) =>
  (res as unknown as { message: AsyncIterable<number> }).message;

describe("accessLog", () => {
  test("Unary は終わったときに 1 行出す", async () => {
    await accessLog(async () => unaryRes())(req);

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(
      /^time=\S+ level=INFO msg=rpc method=\/test\.v1\.Svc\/Do code=ok duration_ms=\d+\.\d request_id=[0-9a-f-]{36}$/,
    );
  });

  test("Unary の失敗はコードを出して、エラーをそのまま投げる", async () => {
    const err = new ConnectError("x", Code.NotFound);

    await expect(
      accessLog(async () => {
        throw err;
      })(req),
    ).rejects.toBe(err);

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("code=not_found");
  });

  test("ストリームは、終わるまで出さず、終わったときに 1 行出す", async () => {
    const res = await accessLog(async () => streamRes(numbers()))(req);
    expect(lines()).toHaveLength(0);

    const received: number[] = [];
    for await (const n of messagesOf(res)) received.push(n);

    expect(received).toEqual([1, 2]);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("code=ok");
  });

  test("ストリームの途中のエラーは、そのコードで出して投げ直す", async () => {
    const err = new ConnectError("boom", Code.Internal);
    const res = await accessLog(async () => streamRes(numbers(err)))(req);

    await expect(async () => {
      for await (const _ of messagesOf(res)) {
        // 読み進める
      }
    }).toThrow();

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("code=internal");
  });

  test("ストリームを読むのをやめたら canceled", async () => {
    const res = await accessLog(async () => streamRes(numbers()))(req);

    for await (const _ of messagesOf(res)) {
      break;
    }

    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("code=canceled");
  });
  describe("request-id", () => {
    test("クライアントの X-Request-Id をログと応答にそのまま出す", async () => {
      const res = await accessLog(async () => unaryRes())(reqWith("abc-123"));

      expect(lines()[0]).toMatch(/ request_id=abc-123$/);
      expect(res.header.get("x-request-id")).toBe("abc-123");
    });

    test("ないときは採番して、ログと応答で同じ値にする", async () => {
      const res = await accessLog(async () => unaryRes())(req);

      const id = res.header.get("x-request-id");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(lines()[0]).toContain(`request_id=${id}`);
    });

    test("形式が合わない値は使わず、採番し直す（ログの key=value を壊されないため）", async () => {
      for (const bad of ["a b", "x=y", "a".repeat(65), ""]) {
        spy.mockClear();
        const res = await accessLog(async () => unaryRes())(reqWith(bad));

        const id = res.header.get("x-request-id");
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(lines()[0]).toMatch(new RegExp(` request_id=${id}$`));
      }
    });

    test("エラーの応答にも同じ ID を付ける", async () => {
      const err = new ConnectError("x", Code.NotFound);

      await expect(
        accessLog(async () => {
          throw err;
        })(reqWith("err-1")),
      ).rejects.toBe(err);

      expect(err.metadata.get("x-request-id")).toBe("err-1");
      expect(lines()[0]).toMatch(/ request_id=err-1$/);
    });
  });
});
