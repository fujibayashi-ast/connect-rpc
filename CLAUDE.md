# CLAUDE.md

## Project Overview

ConnectRPC のサンプル。proto で API を定義し、サーバーとクライアントが ConnectRPC で通信する最小構成を、動くコードとドキュメントで示す

* 目的は「ConnectRPC の使い方が読んで分かること」。機能の多さより、1 つ 1 つが短く読めることを優先する
* 同じ proto から Go と TypeScript の 2 つのサーバーを立て、1 つの React クライアントからどちらにも同じ API で呼べることを示す（言語に依存しないこと）
* 扱うパターンは Unary を最初に、必要になったら Server streaming・エラー処理・interceptor・バリデーションを足す
* 本番運用は想定しない。認証・DB などは、サンプルの主題に必要になるまで入れない

## Core Rules

* 1 Issue = 1 PR を守る
* Issue のスコープ外の変更をしない
* どんな小さなバグ・改善でも必ず Issue を経由する（履歴を残すため、直接実装・PR 作成しない）
* 実装前に方針を説明する
* 実装後に確認手順を記載する
* 未実装の機能を実装済みと説明しない
* 有料プランが必要になるサービス・ライブラリを導入しない

## Tech Stack

初期の想定。変えるときは Issue を立て、この節も合わせて更新する

* モノレポ: bun workspaces は TS 側（`apps/web`・`apps/server-ts`・`packages/gen-ts`）だけを管理する。Go は `go.mod` で独立させる
* クライアント（`apps/web`）: React + Vite。`@connectrpc/connect-web` で Connect プロトコルを直接呼ぶ（プロキシは使わない）
  * 見た目: Tailwind CSS v4（`@tailwindcss/vite`）+ shadcn/ui（`new-york`・neutral・CSS 変数）。部品は `src/components/ui/` に置く（`bunx shadcn@latest add <name>`）。色はアクセント 1 色まで、アニメーションは足さない。破壊的な操作は `AlertDialog` で確認し、入力欄は `aria-invalid` / `aria-describedby` でエラーと結びつける
  * shadcn の CLI は `add` のあとに手直しが要る（import と余計な npm パッケージ）。手順は [docs/development.md](docs/development.md#画面の部品shadcnui)
* サーバー（2 つ。同じ proto を実装する）
  * `apps/server-go`: Go 1.26 + `connectrpc.com/connect/v2`
  * `apps/server-ts`: TypeScript（Node）+ `@connectrpc/connect-node`
* API 定義: protobuf（`packages/proto`）。lint・コード生成は buf（`buf.yaml` / `buf.gen.yaml`）。TS の生成は `protoc-gen-es`。出力先は下の Architecture
* バリデーション: protovalidate のアノテーションを proto に書く（検証コードを手で書かない）。サーバーは interceptor（Go: `connectrpc.com/validate`、TS: `@connectrpc/validate`）、web は `@bufbuild/protovalidate` で送信前に同じルールを実行する。数値を含むルール（長さ・形式）は標準ルールでなく CEL で書き、日本語のメッセージを proto に置く。理由と `fieldErrors.ts` の扱いは [docs/validation.md](docs/validation.md#メッセージを-proto-に置く)
* ログ: 各サーバーにアクセスログ interceptor を置く。Go と TS で出力形式をそろえ、リクエストの中身は出さない。形式と `request_id`（`X-Request-Id`）の仕様は [docs/logging.md](docs/logging.md)
* interceptor の並びは、アクセスログ → 想定外エラーの保護（`maskErrors`）→ 検証。先頭が一番外側（Go も TS も同じ）。理由は [docs/rpc-features.md](docs/rpc-features.md#想定外のエラー)
* 読み取り専用の RPC は proto で `NO_SIDE_EFFECTS` を付けて GET でも呼べるようにする。ハンドラは冒頭で期限（Go の `ctx`、TS の `signal`）を確認する。詳細は [docs/rpc-features.md](docs/rpc-features.md)
* Server streaming（`WatchContacts`）: TS の `accessLog` と `maskErrors` は応答のストリームを包む（Go は何もしなくてよい）。web の一覧は watch に依存させず、watch は「サーバーの変更」欄の通知に使う。watch の呼び出しは既定の期限で切れないよう `timeoutMs: 0`。変える前に [docs/streaming.md](docs/streaming.md) を読む
* Lint / Format: Biome（TS）、`gofmt` / `go vet`（Go）
* サーバーの起動: Docker。ルートの `compose.yaml` で server-go と server-ts を両方立ち上げる。web はホストで `vite` を動かす
* ライブラリの API は推測で書かず、context7 で最新のドキュメントを確認する

## Architecture

```text
compose.yaml    # server-go と server-ts を立ち上げる
packages/
  proto/        # .proto 定義と buf 設定（API の唯一の正）
  gen-ts/       # TS の生成コード（web と server-ts が共有）
  contract-test/ # 起動中の Go / TS サーバーに同じテストを流す契約テスト（bun test）
apps/
  web/          # React + Vite のクライアント
  server-go/    # Go のサーバー（Dockerfile・gen/ を含む）
  server-ts/    # TypeScript のサーバー（Dockerfile を含む）
docs/
  validation.md rpc-features.md streaming.md logging.md protocols.md  # 機能ごとの解説
  production.md   # 実案件で考えること・未実装のこと
  development.md  # 起動・テスト・proto 変更の手順
  claude/         # Claude Code 用の作業手順
```

* README は導入を検討するエンジニア向けの入口（分かること・構成・見られること）。解説は `docs/` に置く

* API 仕様は `packages/proto` で完結させ、`docs/` には書かない
* 生成物（`packages/gen-ts`・`apps/server-go/gen`）は手で編集しない。proto を直して再生成する
* 2 つのサーバーは同じ API を実装し、ポートで区別する（server-go: 8080、server-ts: 8081）。web は接続先を環境変数で切り替える
* 構成は Issue ごとに実装していく。まだ存在しないものは「予定」であり、実装済みと説明しない
* 実際の構成が決まったら、この節を実装に合わせる

## Guidelines

* シンプルに実装する
* 不要なライブラリを追加しない
* `any` を使わない（Biome の `noExplicitAny` を error 運用）
* コメントは理由・制約・非自明な挙動に限る。経緯は PR・コミットメッセージに残す
* API キー・秘密情報をコードに埋め込まない

## Documentation Rules

* 新しい機能を実装する場合、対応するドキュメントを更新する
* 実装とドキュメントの内容を一致させる
* 図は Mermaid で書く

## Issue / PR Rules

* Issue 作成時は `/issue` スキルを使うこと
* 実装前のプランは `/plan` スキルで作る
* PR 作成前に `/review` スキルでセルフレビューを行うこと
* PR 作成時は `/pr` スキルを使うこと
* レビュー指摘への対応は `/fix` スキルを使うこと
* コミットメッセージは `.gitmessage` の形式に従う
* GitHub Release は使わない

## Agent / Token Efficiency

タスクに対して **最小限で足りる agent** を使う

* `scout`（安いモデル）に委譲し、要約だけ受け取る: ファイル・シンボル・参照の検索、test / lint / typecheck / build の実行と結果確認、`git status` / `git diff` の確認
* 自分でやる: 通常の実装・リファクタリング・コードレビュー、単純な逐次作業
* モデル: 計画は `/plan`（プランモード）で Opus、実装は Sonnet で行う。個人設定で `/model opusplan` にしておく（リポジトリの `settings.json` には `model` を入れない。`/model` の選択より優先され、起動のたびに上書きされるため）
* テストは全 pass なら一行の要約、fail したら失敗したテスト名とエラー出力だけ返す
* 生成物は読まない: `bun.lock` / `go.sum` / `node_modules/` / `dist/` / `packages/gen-ts/` / `apps/server-go/gen/`（仕様は `.proto` を見る）
* コマンドは変更したパッケージにスコープする（例: `bun run --filter @connect-rpc/web test`、`cd apps/server-go && go test ./...`）
* 契約テスト（`bun run test:contract`）は両サーバーの起動が前提。API の振る舞いのテストはサーバーごとに書かず、ここに足す

## MCP

`.mcp.json` で共有している

* `context7` — ライブラリの最新ドキュメント。ConnectRPC（connect-go・connect-es）・protobuf・buf・Bun・Docker Compose などの API を推測で書かず、ここで確認する
* `playwright` — ブラウザ操作。web の画面を実際に動かして確認する（起動済みの Google Chrome を使い、プロファイルは保存しない）
* `chrome-devtools` — コンソール・ネットワーク（CORS や Connect のリクエスト）・パフォーマンスの確認。使用統計は無効にしてある

`playwright` と `chrome-devtools` は、初回に承認のプロンプトが出る（`enabledMcpjsonServers` には入れていない。ブラウザを操作するサーバーなので、利用者が自分で承認する）。どちらもバージョンを固定している。上げるときは公開から 2 週間以上たった版にする

## Implementation Workflow

* Issue 着手から PR マージまでの流れは [docs/claude/workflow.md](docs/claude/workflow.md) に従うこと
* 利用可能なスキルは `.claude/skills/` 配下。description / when_to_use に従い、場面に応じて自動的に選ぶこと
