import { describe, expect, spyOn, test } from "bun:test";
import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";
import { maskErrors } from "./errormask.ts";

// interceptor が受け取るリクエストのうち、使う項目だけを持つ
type Req = Parameters<ReturnType<Interceptor>>[0];
const req = {
  service: { typeName: "test.v1.Svc" },
  method: { name: "Do" },
} as unknown as Req;

async function run(thrown: unknown): Promise<ConnectError> {
  const next = async () => {
    throw thrown;
  };
  try {
    await maskErrors(next)(req);
  } catch (err) {
    if (err instanceof ConnectError) return err;
    throw new Error(`ConnectError ではない: ${String(err)}`);
  }
  throw new Error("失敗するはずだった");
}

describe("maskErrors", () => {
  test("想定外のエラーは内容を隠して internal にする", async () => {
    const err = await run(new Error("db password=secret"));

    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("internal error");
  });

  test("Error でない値を投げても隠す", async () => {
    const err = await run("secret string");

    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("internal error");
  });

  test("意図して投げた ConnectError はそのまま通す", async () => {
    const err = await run(
      new ConnectError("contact not found: 1", Code.NotFound),
    );

    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe("contact not found: 1");
  });

  test("期限切れ（deadline_exceeded の ConnectError）はそのまま通す", async () => {
    const err = await run(
      new ConnectError("the operation timed out", Code.DeadlineExceeded),
    );

    expect(err.code).toBe(Code.DeadlineExceeded);
  });

  test("中断（AbortError）は canceled", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";

    const err = await run(abort);

    expect(err.code).toBe(Code.Canceled);
    expect(err.rawMessage).toBe("canceled");
  });

  test("期限切れ（TimeoutError）は deadline_exceeded", async () => {
    const timeout = new Error("signal timed out");
    timeout.name = "TimeoutError";

    const err = await run(timeout);

    expect(err.code).toBe(Code.DeadlineExceeded);
    expect(err.rawMessage).toBe("deadline exceeded");
  });

  test("ストリームの途中で投げられたエラーも internal にする", async () => {
    async function* failing() {
      yield 1;
      throw new Error("db password=secret");
    }
    const res = {
      stream: true,
      message: failing(),
    } as unknown as Awaited<ReturnType<ReturnType<Interceptor>>>;

    const out = await maskErrors(async () => res)(req);
    const it = (out as unknown as { message: AsyncIterable<number> }).message[
      Symbol.asyncIterator
    ]();

    expect((await it.next()).value).toBe(1);
    const err = await it.next().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.Internal);
    expect((err as ConnectError).rawMessage).toBe("internal error");
  });

  // apps/server-go/accesslog_test.go の TestMaskErrorsLog と同じ形式を確かめる。変えるときは両方を直す
  describe("ERROR 行の形式", () => {
    const cases = [
      {
        name: "空白や = を含むメッセージは引用符で囲む",
        thrown: new Error("db password=secret"),
        want: `level=ERROR msg="unexpected error" method=/test.v1.Svc/Do error="db password=secret"`,
      },
      {
        name: "空白や = を含まないメッセージは引用符で囲まない",
        thrown: new Error("boom"),
        want: `level=ERROR msg="unexpected error" method=/test.v1.Svc/Do error=boom`,
      },
    ];
    for (const c of cases) {
      test(c.name, async () => {
        const spy = spyOn(console, "log").mockImplementation(() => {});
        try {
          await run(c.thrown);
          const lines = spy.mock.calls.map((args) => String(args[0]));
          expect(lines).toHaveLength(1);
          // 先頭の time=... は時刻なので比べない
          expect(lines[0]?.split(" ").slice(1).join(" ")).toBe(c.want);
        } finally {
          spy.mockRestore();
        }
      });
    }
  });

  test("エラーがなければ応答をそのまま返す", async () => {
    const res = { message: "ok" } as unknown as Awaited<
      ReturnType<ReturnType<Interceptor>>
    >;

    const got = await maskErrors(async () => res)(req);

    expect(got).toBe(res);
  });
});
