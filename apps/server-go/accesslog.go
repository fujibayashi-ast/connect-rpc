package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
)

// requestIDHeader は、クライアントが付ける呼び出しの識別子。サーバーのログと応答にも同じ値が出る
const requestIDHeader = "X-Request-Id"

// 形式が合わない値は使わない（ログの key=value を壊されないため）。apps/server-ts/src/accesslog.ts と同じ
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// requestID はリクエストの X-Request-Id を返し、応答のヘッダーにも同じ値を付ける。
// ないか、形式が合わなければ UUID を採番する
func requestID(ctx context.Context) string {
	info, ok := connect.CallInfoForServerContext(ctx)
	id := ""
	if ok {
		id = info.RequestHeader().Get(requestIDHeader)
	}
	if !requestIDPattern.MatchString(id) {
		id = uuid.NewString()
	}
	if ok {
		info.ResponseHeader().Set(requestIDHeader, id)
	}
	return id
}

// 出力の形式は apps/server-ts/src/accesslog.ts とそろえてある。変えるときは両方を直す
var rpcLog = slog.New(slog.NewTextHandler(os.Stdout, nil))

// accessLog は RPC ごとに method・結果コード・所要時間を 1 行で出す。
// リクエストの中身とエラーメッセージは出さない（ユーザー入力が入りうるため）
func accessLog(next connect.ServerFunc) connect.ServerFunc {
	return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
		start := time.Now()
		id := requestID(ctx)
		err := next(ctx, spec, stream)

		code := "ok"
		if err != nil {
			code = connect.CodeOf(err).String()
		}
		ms := float64(time.Since(start).Microseconds()) / 1000
		rpcLog.Info("rpc",
			"method", spec.Procedure,
			"code", code,
			"duration_ms", fmt.Sprintf("%.1f", ms),
			"request_id", id,
		)
		return err
	}
}
