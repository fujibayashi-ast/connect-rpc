import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";

// RPC ごとに method・結果コード・所要時間を 1 行で出す。
// リクエストの中身とエラーメッセージは出さない（ユーザー入力が入りうるため）。
// 出力の形式（Go の slog の text 形式）は apps/server-go/accesslog.go とそろえてある。変えるときは両方を直す。
//
// ストリームは、interceptor が応答を返した時点ではまだ終わっていない。応答の message を包み、
// 終わった時点で 1 行出す（duration_ms は接続していた時間）
export const accessLog: Interceptor = (next) => async (req) => {
  const start = performance.now();
  const id = requestId(req.header.get(REQUEST_ID_HEADER));
  try {
    const res = await next(req);
    res.header.set(REQUEST_ID_HEADER, id);
    if (res.stream) {
      return { ...res, message: logWhenDone(req, res.message, start, id) };
    }
    log(req, "ok", start, id);
    return res;
  } catch (err) {
    const e = ConnectError.from(err);
    // エラーの応答にも同じ ID を付ける（metadata は応答のヘッダーになる）
    e.metadata.set(REQUEST_ID_HEADER, id);
    log(req, codeName(e.code), start, id);
    throw e;
  }
};

// クライアントが付ける呼び出しの識別子。サーバーのログと応答にも同じ値が出る
const REQUEST_ID_HEADER = "x-request-id";

// 形式が合わない値は使わない（ログの key=value を壊されないため）。apps/server-go/accesslog.go と同じ
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

// ないか、形式が合わなければ UUID を採番する
function requestId(value: string | null): string {
  return value !== null && REQUEST_ID_PATTERN.test(value)
    ? value
    : crypto.randomUUID();
}

type Req = { service: { typeName: string }; method: { name: string } };

async function* logWhenDone<T>(
  req: Req,
  messages: AsyncIterable<T>,
  start: number,
  id: string,
): AsyncGenerator<T> {
  // 読むのをやめた（クライアントが去った）場合は、ここが canceled のまま残る
  let code = "canceled";
  try {
    yield* messages;
    code = "ok";
  } catch (err) {
    code = codeName(ConnectError.from(err).code);
    throw err;
  } finally {
    log(req, code, start, id);
  }
}

function log(req: Req, code: string, start: number, id: string): void {
  const method = `/${req.service.typeName}/${req.method.name}`;
  const ms = (performance.now() - start).toFixed(1);
  console.log(
    `time=${new Date().toISOString()} level=INFO msg=rpc method=${method} code=${code} duration_ms=${ms} request_id=${id}`,
  );
}

// Code の名前（InvalidArgument）を snake_case（invalid_argument）にする。
// connect の codeToString は内部 API（@private）なので使わない
function codeName(code: Code): string {
  const name = Code[code] ?? "Unknown";
  return (
    name.charAt(0).toLowerCase() +
    name.slice(1).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  );
}
