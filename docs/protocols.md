# Connect・gRPC・gRPC-Web

同じハンドラが、3 つのプロトコルを話せる。proto もハンドラも変えず、サーバーが受けるプロトコルをクライアントが選ぶ。このサンプルの web は Connect を使っている。

| プロトコル | HTTP | ブラウザ | 向いている相手 |
|---|---|---|---|
| Connect | 1.1 / 2 | 使える（GET も使える。curl で読める） | web、curl、新しいクライアント |
| gRPC-Web | 1.1 / 2 | 使える | 既存の gRPC-Web のクライアント |
| gRPC | **2 のみ** | 使えない | サーバー間、既存の gRPC のクライアント |

このページの「測った」は、Go（connect-go v2.0.0）と TS（Node 24 + connect-node）で実際に呼んだ結果。一般論として書いたことは、そう書いてある。

## 今のサンプルで試せること

起動したままの Go（8080）と TS（8081）に、`buf curl` で呼ぶ。

```bash
cd packages/proto
# gRPC-Web: そのまま通る
bunx buf curl --schema . --protocol grpcweb -d '{"pageSize":1}' \
  http://localhost:8080/contact.v1.ContactService/ListContacts

# gRPC: 通らない
bunx buf curl --schema . --protocol grpc --http2-prior-knowledge -d '{"pageSize":1}' \
  http://localhost:8080/contact.v1.ContactService/ListContacts
```

* gRPC-Web は、Go も TS も設定なしで通った（HTTP/1.1 で動くため）
* gRPC は、Go も TS も `http2: ... the frame header looked like an HTTP/1.1 header` で失敗した。サーバーが平文の HTTP/1.1 しか話していないため。TLS なしの HTTP/2（h2c）を有効にする必要がある
* `--http2-prior-knowledge` は、「TLS なしでも最初から HTTP/2 で話す」という指定。付けないと、`buf curl` は http の URL への gRPC を拒否する

## gRPC を受ける（h2c）

### Go

`http.Server` の `Protocols` に、HTTP/1.1 と h2c の両方を指定する（[公式の例](https://connectrpc.com/docs/go/deployment)）。

```go
p := new(http.Protocols)
p.SetHTTP1(true)
p.SetUnencryptedHTTP2(true)
srv := &http.Server{Addr: ":8080", Handler: handler, Protocols: p}
log.Fatal(srv.ListenAndServe())
```

測った結果、これだけで **1 つのポートが全部通る**。gRPC・gRPC-Web・Connect（HTTP/1.1、ブラウザと同じ経路）・Connect（h2c）が、すべて成功した。アクセスログなどの interceptor もそのまま動く。

### TS

Node は、平文のままでは、Go のように 1 つのポートで両方を受けられない。TLS にすれば受けられる。

* **平文の `http2.createServer({ allowHTTP1: true }, handler)` は、HTTP/1.1 を話せない**（測った）。gRPC と h2c の Connect は通るが、HTTP/1.1 のリクエストには HTTP/2 のフレームが返ってくる。ブラウザの Connect と gRPC-Web が壊れる。`allowHTTP1` は、TLS の ALPN で HTTP/1.1 が選ばれたときのための指定で、平文では効かない
* **先頭の 3 バイト（`PRI`）で HTTP/1.1 と HTTP/2 を振り分ける方法は、うまくいかなかった**（測った）。HTTP/1.1 は通ったが、gRPC は `GOAWAY INTERNAL_ERROR` で失敗した。`node:http2` はソケットのネイティブハンドルから直接読むため、読んだあとに戻したバイトが届かないのだと思う（原因は推測）
* 現実的な選択肢:
  * **ポートを分ける:** 今の `http` のサーバーと、`http2.createServer(handler)`（h2c 用）を、同じハンドラで 2 つ立てる。この組み合わせの実測はしていない
  * **TLS にする:** `createSecureServer({ allowHTTP1: true, key, cert }, handler)` なら、**1 つのポートで全部通る**（測った）。ALPN（TLS の接続時にプロトコルを選ぶ仕組み）で、HTTP/1.1 の Connect、HTTP/2 の Connect、gRPC、gRPC-Web が、すべて成功した。ブラウザが HTTP/2 を使えるのも TLS のときだけなので、ブラウザ向けにもこれが本命になる
  * **前段のプロキシに任せる:** TLS を終端するプロキシが、後ろのサーバーに HTTP/1.1 か h2c で渡す。TS 側は、使うプロトコルに合わせて 1 種類だけ受ければよい

Go と TS で、**平文（h2c）で 1 つのポートが 3 つのプロトコルを受ける作りやすさが違う**（Go は設定だけ、TS はできない）。TLS なら、どちらも 1 つのポートで受けられる。

## 実案件で考えること

### エラーは HTTP のステータスに出ない

同じ検証エラー（`invalid_argument`）を、3 つのプロトコルで呼んだ結果（Go と、TLS にした TS で測って、同じだった）。

| プロトコル | HTTP ステータス | エラーの置き場所 |
|---|---|---|
| Connect（Unary） | `400` | 本文の JSON |
| gRPC | `200` | HTTP のトレーラー（`Grpc-Status: 3`） |
| gRPC-Web | `200` | 本文の最後のフレーム（`grpc-status: 3`） |

* gRPC 系は、失敗しても `200` を返す。ロードバランサーやプロキシのログ、HTTP のステータスで数える監視では、エラーが見えない。RPC のコード（`code=`）で数える
* 検証の `Violations` は、gRPC でも gRPC-Web でも `grpc-status-details-bin` で届いた（Go で確認）。`buf curl` は、これを Connect の `details` と同じ形の JSON にして出した
* このサンプルのアクセスログは、プロトコルが違っても同じ形式の 1 行になった（Go と、TLS にした TS で確認）。**どのプロトコルで来たかはログに出ない**。使い分けを知りたければ、`Content-Type` を見て足す

### トレーラーとプロキシ

gRPC は、結果をトレーラー（応答の最後に付くヘッダー）で返す。トレーラーを落とすプロキシや CDN を通すと、結果が届かない。gRPC-Web と Connect は結果を本文に入れるので通る（一般論。このサンプルでは、プロキシを挟んだ確認はしていない）。

### ロードバランサー

gRPC は 1 本の HTTP/2 接続に多数の呼び出しを載せる。TCP（L4）で振り分けると、接続を張った 1 台に呼び出しが偏る。HTTP/2 を理解する L7 の振り分けにするか、クライアントが複数のサーバーに分けて呼ぶ（一般論）。

### h2c を使う場所

ブラウザは、HTTP/2 を TLS でしか使えない。多くの構成では、ブラウザ → プロキシは TLS、プロキシ → サーバーは h2c になる。gRPC のクライアントから直接呼ぶときも、サーバーが h2c を受ける。ブラウザの同時接続の制限は、[streaming.md](streaming.md#http11-と-http2) を参照。

### CORS

ブラウザから gRPC-Web を呼ぶなら、`X-Grpc-Web`・`X-User-Agent`・`Grpc-Timeout` の許可と、`Grpc-Status`・`Grpc-Message`・`Grpc-Status-Details-Bin` の公開が要る。このサンプルは、Go（`connectcors`）も TS（`cors`）も、すでに許可・公開していて、プリフライトが通ることを測った。

### ヘルスチェックと Reflection

* ロードバランサーや Kubernetes の gRPC のヘルスチェックは、gRPC の health プロトコル（`grpc.health.v1`）を使う。Go（connect-go v2）には `grpchealth.Register(server, checker)` がある（公式ドキュメントで確認。動かしてはいない）。TS 側のパッケージは確認していない。このサンプルの `/healthz` は HTTP の GET
* grpcurl などから proto なしで呼ぶには、Reflection が要る。Go は `grpcreflect.Register(server)`（公式ドキュメントで確認。動かしてはいない）。TS は、`@connectrpc` の npm パッケージ（`npm search @connectrpc`）に Reflection のものが見当たらず、公式の実装は確認できなかった。2 つのサーバーで同じ作りにならないので実装しない。このサンプルは `buf curl --schema .` で proto を渡している（手元に proto があれば、Reflection なしで足りる）

### 使い分け

サーバーはどれも受けられるので、クライアントの都合で選べる。ブラウザからは Connect を使うのがよい（GET とキャッシュが使え、curl で読める）。既存の gRPC-Web のクライアントがあれば、gRPC-Web のまま使える。サーバー間や既存の gRPC のクライアントは、gRPC で呼べる。
