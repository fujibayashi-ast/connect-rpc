package main

import (
	"log"
	"net/http"
	"os"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	connectcors "connectrpc.com/cors"
	"connectrpc.com/validate"
	"github.com/rs/cors"

	"connect-rpc/server-go/gen/contact/v1/contactv1connect"
)

func main() {
	port := getenv("PORT", "8080")
	// ブラウザから直接呼ぶため、web の dev サーバーのオリジンを許可する
	origin := getenv("CORS_ORIGIN", "http://localhost:5173")

	// 検証ルールは proto に宣言してあり、interceptor が実行する。ハンドラには検証済みの値しか来ない。
	// 先頭が一番外側。accessLog を一番外に置くと、検証エラーも想定外のエラー（internal に丸めたあと）もログに残る
	server := connect.NewServer(accessLog, maskErrors, validate.NewServerInterceptor())
	contactv1connect.RegisterContactServiceHandler(server, &contactServer{})

	mux := http.NewServeMux()
	connecthttp.Mount(mux, server)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	// データは変わるので、GET の応答もブラウザに使い回させず、毎回サーバーに確認させる
	noCache := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		mux.ServeHTTP(w, r)
	})

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{origin},
		AllowedMethods: connectcors.AllowedMethods(),
		// X-Request-Id は web が付ける。応答でも読めるよう公開する
		AllowedHeaders: append(connectcors.AllowedHeaders(), requestIDHeader),
		ExposedHeaders: append(connectcors.ExposedHeaders(), requestIDHeader),
		// 値は Chrome の上限（2 時間）。ブラウザがプリフライトを POST のたびに送らなくなる
		MaxAge: 7200,
	}).Handler(noCache)

	log.Printf("server-go listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
