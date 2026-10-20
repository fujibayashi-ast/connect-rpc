package main

import (
	"context"
	"errors"

	"connectrpc.com/connect/v2"
)

// maskErrors はハンドラが返した想定外のエラー（Connect のエラーでないもの）を扱う。
// 元のエラーはサーバーのログにだけ出し、クライアントには internal と固定のメッセージだけを返す。
// フレームワークの既定でも内容はクライアントに届かないが、そのままだと
// 原因がログに残らず、コードも言語で違う（Go は unknown、TS は internal）。ここでそろえる。
// ログの形式は apps/server-ts/src/errormask.ts とそろえてある。変えるときは両方を直す
func maskErrors(next connect.ServerFunc) connect.ServerFunc {
	return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
		err := next(ctx, spec, stream)
		if err == nil {
			return nil
		}
		return maskError(spec.Procedure, err)
	}
}

func maskError(method string, err error) error {
	// NotFound などハンドラが意図して返したエラーは、そのまま通す
	if _, ok := errors.AsType[*connect.Error](err); ok {
		return err
	}
	// 期限切れとキャンセルは想定外ではない。internal に丸めない
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return connect.NewError(connect.CodeDeadlineExceeded, "deadline exceeded").WithCause(err)
	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, "canceled").WithCause(err)
	}
	rpcLog.Error("unexpected error", "method", method, "error", err.Error())
	return connect.NewError(connect.CodeInternal, "internal error").WithCause(err)
}
