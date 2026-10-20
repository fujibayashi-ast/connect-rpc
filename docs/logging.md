# ログ

両サーバーは、RPC ごとに 1 行のアクセスログを標準出力に出す（interceptor）。Go（`log/slog`）と TS で同じ形式にそろえてある。

```text
time=2026-10-15T01:23:45.678Z level=INFO msg=rpc method=/contact.v1.ContactService/CreateContact code=ok duration_ms=2.4 request_id=6f1c0f0e-8a52-4d3b-9a43-0e7c1f2d9b11
time=2026-10-15T01:23:46.012Z level=INFO msg=rpc method=/contact.v1.ContactService/CreateContact code=invalid_argument duration_ms=0.3 request_id=0b7d2a64-51c8-4e0a-8f3d-2c9a77e1d4f0
```

* `code` は成功なら `ok`、失敗なら Connect のコード（`not_found`、`already_exists` など）
* リクエストの中身とエラーメッセージは出さない（email などの入力が入りうるため）
* interceptor はログ、検証の順に並べてあるので、検証で弾かれた呼び出しも残る。`/healthz` は RPC ではないので出ない
* 確認: `docker compose logs server-go server-ts`

## request_id

* `request_id` は、クライアントが付けた `X-Request-Id` ヘッダーの値。web は呼び出しごとに UUID を付ける（クライアントの interceptor、[requestId.ts](../apps/web/src/requestId.ts)）ので、画面の操作とサーバーのログを突き合わせられる
* サーバーは同じ値を、エラーも含む応答のヘッダーに付けて返す
* ないとき、または `[A-Za-z0-9-]{1,64}` に合わないとき（ログの `key=value` を壊せる文字を含むなど）は、サーバーが UUID を採番する
* ブラウザから `X-Request-Id` を送る・応答で読むには、CORS で許可・公開が要る（両サーバーに設定済み）

## 形式をそろえる仕組み

interceptor は言語ごとの実装なので、proto のように一括では書けない。形式を変えるときは [accesslog.go](../apps/server-go/accesslog.go) と [accesslog.ts](../apps/server-ts/src/accesslog.ts) の両方を直す。アプリ固有のログは各ハンドラに書く。

そろっていることは、テストで確かめている。

* 同じ正規表現で、アクセスログの 1 行の形を両側から確かめる（[accesslog_test.go](../apps/server-go/accesslog_test.go)、[accesslog.test.ts](../apps/server-ts/src/accesslog.test.ts)）
* 想定外のエラーの行（`level=ERROR`）も、同じ期待値で両側から確かめる。値に空白や `=` を含むときだけ引用符で囲む（Go の `slog` の規則）
* request_id の受け渡し（採用、採番、不正値の置き換え、エラー応答）は、契約テストで両サーバーに同じテストを流す

## 制限

* `time` は、TS は常に UTC、Go はそのマシンのタイムゾーンで出す。コンテナは UTC なので同じ表記になるが、ホストで直接動かすと Go だけ変わる
* ストリーム（`WatchContacts`）は、**終わった時点**で 1 行出る。`duration_ms` は接続していた時間で、つなぎっぱなしの watch は切れるまでログに出ない。クライアントが去ると `code=canceled`
* 制御文字を含むエラーメッセージの引用符の中の書き方は、Go（`\x01`）と TS（`\u0001`）で違う
