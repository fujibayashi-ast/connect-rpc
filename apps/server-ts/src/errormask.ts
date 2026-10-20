import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";

// ハンドラが投げた想定外のエラー（ConnectError でないもの）を扱う。
// 元のエラーはサーバーのログにだけ出し、クライアントには internal と固定のメッセージだけを返す。
// フレームワークの既定でも内容はクライアントに届かないが、そのままだと
// 原因がログに残らず、アクセスログには unknown と出る（クライアントに届くのは internal）。ここでそろえる。
// ログの形式は apps/server-go/errormask.go とそろえてある。変えるときは両方を直す
//
// ストリームは、エラーが応答を返したあと（読んでいる途中）に投げられる。
// 応答の message を包んで、その途中のエラーも丸める
export const maskErrors: Interceptor = (next) => async (req) => {
  const method = `/${req.service.typeName}/${req.method.name}`;
  try {
    const res = await next(req);
    if (res.stream) {
      return { ...res, message: maskStream(method, res.message) };
    }
    return res;
  } catch (err) {
    throw maskError(method, err);
  }
};

async function* maskStream<T>(
  method: string,
  messages: AsyncIterable<T>,
): AsyncGenerator<T> {
  try {
    yield* messages;
  } catch (err) {
    throw maskError(method, err);
  }
}

// Go の slog（text 形式）に合わせて、空・空白・=・"・制御文字を含む値だけ引用符で囲む。
// 制御文字の escape の書き方までは同じではない（Go は \x01、ここは \u0001）
function quoteIfNeeded(value: string): string {
  const needsQuote =
    value === "" ||
    /[\s="]/.test(value) ||
    [...value].some((ch) => ch < " " || ch === "\u007f");
  return needsQuote ? JSON.stringify(value) : value;
}

export function maskError(method: string, err: unknown): ConnectError {
  // NotFound や deadline_exceeded など、意図して投げた ConnectError はそのまま通す
  if (err instanceof ConnectError) return err;
  // 期限切れ（AbortSignal.timeout() など）は deadline_exceeded。Go の context.DeadlineExceeded と同じにする
  if (err instanceof Error && err.name === "TimeoutError") {
    return new ConnectError(
      "deadline exceeded",
      Code.DeadlineExceeded,
      undefined,
      undefined,
      err,
    );
  }
  // クライアントの中断は想定外ではない。internal に丸めない
  if (err instanceof Error && err.name === "AbortError") {
    return new ConnectError(
      "canceled",
      Code.Canceled,
      undefined,
      undefined,
      err,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  console.log(
    `time=${new Date().toISOString()} level=ERROR msg="unexpected error" method=${method} error=${quoteIfNeeded(message)}`,
  );
  return new ConnectError(
    "internal error",
    Code.Internal,
    undefined,
    undefined,
    err,
  );
}
