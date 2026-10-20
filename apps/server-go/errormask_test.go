package main

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"connectrpc.com/connect/v2"
)

func TestMaskErrors(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		wantCode connect.Code
		wantMsg  string
	}{
		{
			name:     "想定外のエラーは内容を隠して internal にする",
			err:      errors.New("db password=secret"),
			wantCode: connect.CodeInternal,
			wantMsg:  "internal error",
		},
		{
			name:     "包まれた想定外のエラーも隠す",
			err:      fmt.Errorf("load: %w", errors.New("secret path /etc/x")),
			wantCode: connect.CodeInternal,
			wantMsg:  "internal error",
		},
		{
			name:     "意図して返した Connect のエラーはそのまま通す",
			err:      connect.NewError(connect.CodeNotFound, "contact not found: 1"),
			wantCode: connect.CodeNotFound,
			wantMsg:  "contact not found: 1",
		},
		{
			name:     "期限切れは deadline_exceeded",
			err:      context.DeadlineExceeded,
			wantCode: connect.CodeDeadlineExceeded,
			wantMsg:  "deadline exceeded",
		},
		{
			name:     "包まれた期限切れも deadline_exceeded",
			err:      fmt.Errorf("query: %w", context.DeadlineExceeded),
			wantCode: connect.CodeDeadlineExceeded,
			wantMsg:  "deadline exceeded",
		},
		{
			name:     "キャンセルは canceled",
			err:      context.Canceled,
			wantCode: connect.CodeCanceled,
			wantMsg:  "canceled",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			next := func(context.Context, connect.Spec, connect.ServerStream) error { return tt.err }

			got := maskErrors(next)(context.Background(), connect.Spec{Procedure: "/test.v1.Svc/Do"}, nil)

			connectErr, ok := errors.AsType[*connect.Error](got)
			if !ok {
				t.Fatalf("got %T, want *connect.Error", got)
			}
			if connectErr.Code() != tt.wantCode {
				t.Errorf("code = %v, want %v", connectErr.Code(), tt.wantCode)
			}
			if connectErr.Message() != tt.wantMsg {
				t.Errorf("message = %q, want %q", connectErr.Message(), tt.wantMsg)
			}
		})
	}

	t.Run("エラーがなければそのまま通す", func(t *testing.T) {
		next := func(context.Context, connect.Spec, connect.ServerStream) error { return nil }
		if got := maskErrors(next)(context.Background(), connect.Spec{}, nil); got != nil {
			t.Errorf("got %v, want nil", got)
		}
	})
}
