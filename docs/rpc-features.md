# RPC の機能

## GET で呼ぶ

読み取り専用の RPC（`GetContact`、`ListContacts`）には、proto で `idempotency_level = NO_SIDE_EFFECTS` を付けてある。Connect はこれを GET でも呼べる（POST でも呼べる）。web の transport は `useHttpGet: true` で、該当する RPC だけを GET にする。

画面では、次の 2 箇所が GET で呼ぶ。

* 起動時と「一覧を再読み込み」で、一覧を作る `ListContacts`（[listAllContacts.ts](../apps/web/src/listAllContacts.ts)）
* 一覧の名前を押したときの詳細表示の `GetContact`（[ContactDetail.tsx](../apps/web/src/ContactDetail.tsx)）

```bash
curl 'http://localhost:8080/contact.v1.ContactService/ListContacts?connect=v1&encoding=json&message=%7B%7D'
```

* 付けていない RPC（`CreateContact` など）を GET で呼ぶと `405`
* データは変わるので、サーバーは応答に `Cache-Control: no-cache` を付け、ブラウザに古い一覧を使い回させない。どう使い回させるか（キャッシュの期限、ETag）はサーバー側の判断で、proto には書かない
* GET は独自のヘッダー（`X-Request-Id`）が付くので、CORS のプリフライトが飛ぶ。`Access-Control-Max-Age` で使い回される

## ページング

`ListContacts` は `page_size` と `page_token` で 1 ページずつ返す（[AIP-158](https://google.aip.dev/158) の形）。web は `next_page_token` が空になるまでたどって、全件を取る（[listAllContacts.ts](../apps/web/src/listAllContacts.ts)）。

```bash
cd packages/proto
bunx buf curl --schema . --protocol connect -d '{"pageSize":2}' \
  http://localhost:8080/contact.v1.ContactService/ListContacts
# 応答の nextPageToken を、次の呼び出しの pageToken に入れる
bunx buf curl --schema . --protocol connect -d '{"pageSize":2,"pageToken":"<nextPageToken>"}' \
  http://localhost:8080/contact.v1.ContactService/ListContacts
```

* `page_size` は 0（既定の 50）〜100。範囲外は検証で `invalid_argument`
* `next_page_token` は次のページがあるときだけ入り、空なら最後のページ。クライアントはトークンの中身を読まず、そのまま返す
* トークンの中身は、登録の通し番号を base64url にしたもの（Go と TS で同じ）。次のページは「その番号より後」なので、めくっている間に削除や追加があっても、飛んだり重複したりしない（offset だと 1 件飛ぶ）。壊れたトークンは `invalid_argument`

## タイムアウト

* クライアントが期限を指定すると、`Connect-Timeout-Ms` ヘッダーでサーバーに伝わる（web は `defaultTimeoutMs` で 10 秒）。サーバーでは Go が `ctx` の期限、TS が `signal` として受け取る
* ハンドラは期限を守る。各ハンドラの先頭で確認し、切れていれば何もせずに返す（`deadline_exceeded`）。実際のアプリでは、DB などの呼び出しにも `ctx` / `signal` を渡す
* 期限 `0` は「最初から期限切れ」でサーバーに届く。契約テストはこれで、遅いハンドラを用意せずに確認している
* サーバー側の上限（長すぎる期限を打ち切る）は各サーバーの設定。TS には `connectNodeAdapter({ maxTimeoutMs })` があり、Go は `http.Server` のタイムアウトなどで行う。このサンプルでは設定していない

## 想定外のエラー

ハンドラが想定外のエラー（`NotFound` などの意図したもの以外）を返したとき、`maskErrors` の interceptor が、クライアントには `internal` と固定のメッセージだけを返し、原因はサーバーのログにだけ出す。

```text
time=2026-10-15T01:23:45.678Z level=ERROR msg="unexpected error" method=/contact.v1.ContactService/ListContacts error="..."
```

* フレームワークの既定でも内容はクライアントに届かない。ただし、そのままだと原因がログに残らず、コードも言語で違う（Go は `unknown`、TS は `internal`）。この interceptor でログとコードをそろえている
* 期限切れとキャンセルは想定外ではないので、`internal` に丸めずに通す
* interceptor の並びは、ログ → 想定外エラーの保護 → 検証。ログが一番外側なので、検証エラーも `internal` に丸めたあとのコードも記録される
