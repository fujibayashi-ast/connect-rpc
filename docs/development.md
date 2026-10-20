# 開発の手順

## 必要なもの

* bun
* Docker（Docker Compose）

buf と protoc-gen-es は `bun install` で入る。Go はサーバーを Docker で動かすため、ホストに入れなくてよい。

## 起動

```bash
bun install

# サーバーを両方起動（Go: 8080、TS: 8081）
docker compose up -d --build --wait
curl localhost:8080/healthz
curl localhost:8081/healthz
docker compose down

# クライアント（接続先は VITE_API_URL。省略すると Go の http://localhost:8080）
bun run --filter @connect-rpc/web dev
VITE_API_URL=http://localhost:8081 bun run --filter @connect-rpc/web dev
```

CORS は `CORS_ORIGIN`（既定は `http://localhost:5173`）のオリジンだけを許可する。web を別のポートで動かすときは、サーバーの環境変数も合わせる。プリフライトの結果は `Access-Control-Max-Age: 7200`（Chrome の上限の 2 時間）でブラウザに使い回させる。付けないと、ブラウザは POST のたびに `OPTIONS` を送る。

## 画面の部品（shadcn/ui）

`apps/web` の見た目は Tailwind CSS と shadcn/ui。部品は `apps/web/src/components/ui/` にコピーされていて、必要なら直接編集してよい（`CardTitle` は見出しとして読み上げられるよう `h2` にしてある）。部品を足すときは `apps/web` で実行する。

```bash
cd apps/web && bunx --bun shadcn@latest add <部品名>
```

生成された import が `from "cn"` になっていたら `@/lib/utils` に直し、`cn` という別の npm パッケージが入っていれば `bun remove cn` で消す。

## proto の変更

API の定義と検証ルールは [packages/proto](../packages/proto) だけにある。変えたら lint と互換性の確認をして、コードを生成し直す。生成物（`packages/gen-ts`、`apps/server-go/gen`）は手で編集しない。

```bash
bun run proto:lint
bun run proto:breaking
bun run generate
```

`proto:breaking` は、作業ツリーの proto をローカルの `main` と比べ、後方互換性を壊す変更（フィールドや RPC の削除、フィールド番号・型の変更など）を `buf breaking`（ルールは `buf.yaml` の `FILE`）で検出する。何も出なければ互換性は保たれている。`origin/main` が進んでいるときは、先に `git pull` で `main` を更新する。

壊れる変更が出たら、フィールドを消さずに新しいフィールドを足すなど、古いクライアントが動き続ける形にできないか考える。`FILE` は厳しいルールで、フィールドを `reserved` にしても「削除された」と指摘される（番号の再利用は防げるが、指摘は消えない）。意図して消すなら、`reserved` にしたうえで、この指摘は承知のうえで進めてよい。

## curl で試す

サーバーを起動したうえで、`buf curl` で proto の定義をもとに呼べる。

```bash
cd packages/proto
bunx buf curl --schema . --protocol connect \
  -d '{"contact":{"name":"山田太郎","email":"taro@example.com","category":"CATEGORY_GENERAL"}}' \
  http://localhost:8080/contact.v1.ContactService/CreateContact
```

## 開発コマンド

```bash
bun run lint        # Biome
bun run format      # Biome（自動修正）
bun run typecheck   # TS の型チェック
```

## テスト

```bash
# 単体テスト（サーバー不要）: web のエラー変換と通知文、server-ts の想定外エラーの保護・アクセスログ・watch
bun run test:unit

# Go のテスト（Docker で実行する。ホストの Go は古くてもよい）
bun run test:go

# 契約テスト: 先に両サーバーを起動しておく
docker compose up -d --build --wait
bun run test:contract
```

### 契約テスト

[packages/contract-test](../packages/contract-test) は、起動中の Go と TS のサーバーに**同じテスト**を流す。API の振る舞いのテストはサーバーごとに書かず、ここに足す。確認していること

* CRUD の振る舞い（UUID の採番、全フィールドの置換、削除後の `not_found`）
* 検証パターンごとに、同じ違反（フィールドと ruleId）が返ること
* email の重複・存在しない ID のエラー（重複は検証失敗と同じ `Violations` で届く）
* CORS のプリフライト
* Server streaming（最初に snapshot、変更が起きた順に届く、複数の購読者、中止、期限）
* Connect の GET（`NO_SIDE_EFFECTS` の RPC だけ、`Cache-Control` が付くこと）
* ページング（登録順、めくる途中の削除、壊れたトークン、`page_size` の範囲、GET）
* request-id（そのまま返る・採番される・不正な値は置き換わる・エラー応答にも付く・CORS）
* タイムアウト（期限 0 で `deadline_exceeded`、何も作られないこと、不正な値は `invalid_argument`）
* web が送信前に使う検証器（`@bufbuild/protovalidate`）が、サーバーと同じ結果になること

接続先は `GO_URL`（既定 `http://localhost:8080`）と `TS_URL`（既定 `http://localhost:8081`）で変えられる。8081 を別のプロセスが使っているときは、server-ts を別のポートで起動して `TS_URL=http://localhost:8082 bun run test:contract` のように指定する。

テストごとに一意な email を使い、作ったデータは消すので、サーバーを再起動しなくても何度でも流せる。ただし同じサーバーを手で操作している最中には流さないこと（List の結果などに影響しうる）。
