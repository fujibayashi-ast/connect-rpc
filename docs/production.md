# 実案件で考えること・未実装のこと

このサンプルは本番運用を想定していない。実案件に持ち込むときに考えること（実装していない）と、proto を起点にできること（これも実装していない）をまとめる。ここに書いたものは実装していない。ライブラリの名前や版は、使う時点で確認すること。

## 実案件で考えること

### サーバーの設定

* **Go のタイムアウト:** `main.go` は `http.ListenAndServe` を直接使っていて、`ReadHeaderTimeout` などがない。ヘッダーを送らずに接続を保つクライアントを切れない。`http.Server` の `WriteTimeout` は応答全体にかかるので、そのまま付けると長く続く `WatchContacts` も打ち切られうる。streaming があるときは、`WriteTimeout` を付けるか、応答ごとに期限を扱う（`http.ResponseController` など）かを決める。この組み合わせは、このサンプルでは試していない
* **メッセージサイズの上限:** 既定が言語で違う。Go（connect v2）は 1 メッセージ 4 MiB で、`connecthttp.WithReadMaxBytes` で変える（`connecthttp.Mount` に渡す）。TS は `connectNodeAdapter({ readMaxBytes })` で、既定は約 4 GiB（実質、上限なし）。検証はメッセージを読み込んだあとに動くので、`name` を 50 文字以内にしていても、巨大なメッセージは先に読み込まれる。実案件では TS にも上限を付ける
* **コンテナ:** Dockerfile は root で動く。実案件では `USER` で一般ユーザーにする
* **TS の実行:** Node の型除去で `.ts` をそのまま実行している（ビルドを省くための、意図した割り切り）。実案件ではビルドして JavaScript を動かすことが多い

### ネットワーク

* **プロキシ越しの streaming:** リバースプロキシが応答をバッファすると、`change` がすぐ届かない（例: nginx は `proxy_buffering` を切る）。アイドル時間でも切られるので、[ハートビート](streaming.md#web-の再接続)を検討する
* **HTTP/2 と TLS:** ブラウザで HTTP/2 を使うには TLS が要る。同時接続の制限は [streaming.md](streaming.md#http11-と-http2) を参照
* **gRPC を受ける:** h2c の設定、ロードバランサー、トレーラー、監視（gRPC は失敗しても HTTP 200）は [protocols.md](protocols.md) を参照

### API の設計

* **Create の冪等性:** 応答が届く前に通信が切れて、クライアントが再送すると、二重に作られうる。このサンプルは `email` の重複で結果的に防いでいるだけ。一般には冪等キー（クライアントが付ける識別子）を受け取り、同じキーなら同じ結果を返す
* **互換性の管理:** proto を変えたときの破壊的変更は `buf breaking` で検出できる。このサンプルは使っていない

## 未実装のこと

proto を起点にすると、次のこともできる。

### 生成

* **JSON Schema の生成:** `buf.build/bufbuild/protoschema-jsonschema`（protovalidate のルールも反映される）。フォームのライブラリに検証の定義を渡したいときに使える。このサンプルは、ブラウザでも protovalidate をそのまま実行しているので使っていない
* **OpenAPI の生成:** `buf.build/community/sudorandom-connect-openapi`。Connect の API を、REST のツール（ドキュメントの表示、HTTP クライアントの生成）につなげられる。GET や protovalidate のオプションがある
* **他の言語のクライアント:** 同じ proto から、Swift（[connect-swift](https://github.com/connectrpc/connect-swift)）などのクライアントを作れる。対応言語は [Connect の公式ドキュメント](https://connectrpc.com/docs/introduction)を参照

### RPC の機能

* **認証ヘッダー:** `Authorization` は HTTP ヘッダー（Connect ではメタデータ）で運ぶ。
  * クライアントの interceptor で付け、サーバーの interceptor で検証して `unauthenticated` を返す
  * 運び方は RPC の仕組みだが、誰を許可するか（ユーザー、トークンの発行）はアプリ固有
  * ブラウザには秘密を置けないので、トークンの扱いは別に設計が要る
  * CORS で `Authorization` ヘッダーの許可も要る
* **FieldMask による部分更新:** `UpdateContact` は全フィールドを置き換える。変えたい項目だけを送りたいときは、`google.protobuf.FieldMask`（`update_mask`）を足して、マスクに挙げたフィールドだけを更新する（[AIP-134](https://google.aip.dev/134) の形）。
  * 落とし穴: 「phone だけ更新」のリクエストには `name` がないので、リクエストを `Contact` のルールでそのまま検証すると、必須の `name` で弾かれる
  * 設計: interceptor にはリクエストの形（対象の ID とマスク）だけを検証させる。`contact` は `ignore = IGNORE_ALWAYS`、マスクは `field_mask.in` で許可するパスを絞る。`Contact` のルールは、ハンドラが「既存の値 + マスク分」に対して実行する（Go は `protovalidate.Validate`、TS は `createValidator()`）
  * 違反のパスをリクエストの形（`contact.name`）にそろえると、web は今の処理（[fieldErrors.ts](../apps/web/src/fieldErrors.ts)）のまま入力欄にエラーを出せる。項目をまたぐルール（「その他」なら内容が必須）も、マージ後の値で正しく判定できる
  * 代わりに、検証がハンドラの呼び出しに依存するので、サーバーの言語が増えるたびに同じ実装が要る。マスクに挙げて値が空なら、そのフィールドを空にする
  * このサンプルは、検証を interceptor に任せる形を保ち、短く読めることを優先して、全置換にしている
* **Client streaming / 双方向ストリーミング:** ブラウザの connect-web が対応するのは Unary と Server streaming だけで、この 2 つはブラウザからは使えない。サーバー間や他の言語のクライアントからなら使える

### ライブラリ

* **connect-query（TanStack Query との統合）:** [`@connectrpc/connect-query`](https://github.com/connectrpc/connect-query-es) は、React のデータ取得（キャッシュ・再取得・ローディング状態）を TanStack Query に任せ、RPC を `useQuery` などのフックで呼べるようにする。`TransportProvider` に、このサンプルの `createConnectTransport` をそのまま渡せる。このサンプルは依存を増やさないために `connect-web` の client を直接呼んでいる
* **OpenTelemetry:** Go には公式の interceptor [`connectrpc.com/otelconnect`](https://github.com/connectrpc/otelconnect-go)（トレースとメトリクス）がある。確認できた使い方は connect-go v1 の書き方（`connect.WithInterceptors`）だけで、このサンプルが使う v2 の `connect.NewServer` に渡せるかは確認していない。TS 側のパッケージは確認できていない。使う時点で調べること
