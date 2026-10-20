---
name: pr
description: Pull Request を作成する。PR 作成時は必ずこの Skill を使うこと。
when_to_use: PR を作りたい、プルリクエストを出したい時
argument-hint: "[対応する Issue 番号]"
model: haiku
context: fork
background: false
---

# PR 作成

会話の履歴を持たない Haiku のサブエージェントで動く。必要な情報は Issue と git から集める

## ルール

- 1 Issue = 1 PR を厳守する
- `.github/PULL_REQUEST_TEMPLATE.md` に必ず従う
- Issue のスコープ外の変更を含めない
- 確認手順は必ず記載する
- コミットはしない。未コミットの変更があれば、PR を作らずに報告して止まる

## 手順

### 1. 対応 Issue を確認する

Issue 番号は `$ARGUMENTS`。渡されていなければ、推測せずに止まって報告する

```bash
gh issue view {番号} --comments
```

本文とプランのコメント（スコープ外・テスト・確認手順）を読む

### 2. 変更内容を把握する

```bash
git status --short
git log main..HEAD --oneline
git diff main...HEAD --stat
```

中身が必要なファイルだけ `git diff main...HEAD -- {パス}` で読む。生成物（`gen/`・`bun.lock`）は読まない

### 3. PR の内容を作成する

`.github/PULL_REQUEST_TEMPLATE.md` を読み、各セクションに沿って埋める

- **確認手順**: 必ず記載する。プランの「テスト・確認手順」を元に、実際の変更に合わせて書く
- **スコープ外**: プランの内容を書く。対応しなかった項目があれば明示し、必要なら別 Issue に切り出す
- **スクリーンショット**: 提供されていなければセクションごと省略する

### 4. PR を作成する

```bash
git push -u origin HEAD
gh pr create --title "PRタイトル" --body-file -
```

本文の末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)` を付ける

### 5. 結果を報告する

作成した PR の URL だけを返す
