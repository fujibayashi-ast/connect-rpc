package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
)

// captureLog は rpcLog を差し替えて、出力された行を返す。テストが終わったら戻す
func captureLog(t *testing.T) func() []string {
	t.Helper()
	var buf bytes.Buffer
	orig := rpcLog
	rpcLog = slog.New(slog.NewTextHandler(&buf, nil))
	t.Cleanup(func() { rpcLog = orig })
	return func() []string {
		out := strings.TrimSuffix(buf.String(), "\n")
		if out == "" {
			return nil
		}
		return strings.Split(out, "\n")
	}
}

func runAccessLog(err error) error {
	next := func(context.Context, connect.Spec, connect.ServerStream) error { return err }
	return accessLog(next)(context.Background(), connect.Spec{Procedure: "/test.v1.Svc/Do"}, nil)
}

// apps/server-ts/src/accesslog.test.ts と同じ形式を確かめる。変えるときは両方を直す。
// request_id の受け渡し（ヘッダーからの採用・不正値の置き換え）は、単体ではリクエストの
// 情報を作れないので、契約テスト（packages/contract-test/src/request-id.test.ts）で確かめている
var accessLogLine = regexp.MustCompile(
	`^time=\S+ level=INFO msg=rpc method=/test\.v1\.Svc/Do code=(\w+) duration_ms=\d+\.\d request_id=[0-9a-f-]{36}$`,
)

func TestAccessLog(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		wantCode string
	}{
		{"成功は ok", nil, "ok"},
		{"失敗は Connect のコード", connect.NewError(connect.CodeNotFound, "x"), "not_found"},
		{"キャンセルは canceled", connect.NewError(connect.CodeCanceled, "x"), "canceled"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lines := captureLog(t)

			got := runAccessLog(tt.err)

			if got != tt.err {
				t.Errorf("err = %v, want %v（そのまま返す）", got, tt.err)
			}
			out := lines()
			if len(out) != 1 {
				t.Fatalf("lines = %q, want 1 line", out)
			}
			m := accessLogLine.FindStringSubmatch(out[0])
			if m == nil {
				t.Fatalf("line %q does not match %s", out[0], accessLogLine)
			}
			if m[1] != tt.wantCode {
				t.Errorf("code = %q, want %q", m[1], tt.wantCode)
			}
		})
	}
}

// apps/server-ts/src/errormask.test.ts と同じ形式を確かめる。変えるときは両方を直す
func TestMaskErrorsLog(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{
			name: "空白や = を含むメッセージは引用符で囲む",
			err:  errors.New("db password=secret"),
			want: `level=ERROR msg="unexpected error" method=/test.v1.Svc/Do error="db password=secret"`,
		},
		{
			name: "空白や = を含まないメッセージは引用符で囲まない",
			err:  errors.New("boom"),
			want: `level=ERROR msg="unexpected error" method=/test.v1.Svc/Do error=boom`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lines := captureLog(t)

			_ = maskError("/test.v1.Svc/Do", tt.err)

			out := lines()
			if len(out) != 1 {
				t.Fatalf("lines = %q, want 1 line", out)
			}
			// 先頭の time=... は時刻なので比べない
			_, rest, _ := strings.Cut(out[0], " ")
			if rest != tt.want {
				t.Errorf("line = %q, want %q", rest, tt.want)
			}
		})
	}
}
