#!/bin/bash
# PreToolUse hook: クレデンシャル・機密ファイルへのアクセスをブロックする
#
# 対象ツール: Bash / Read / Edit / Write / NotebookEdit
# 判定: tool_input の command / file_path に既知のクレデンシャルパターンが含まれていれば exit 2 でブロック
# 参考: https://docs.claude.com/en/docs/claude-code/hooks

set -euo pipefail

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
command=$(echo "$input" | jq -r '.tool_input.command // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')

target=""
case "$tool_name" in
  Bash)
    target="$command"
    ;;
  Read|Edit|Write|NotebookEdit)
    target="$file_path"
    ;;
  *)
    exit 0
    ;;
esac

if [ -z "$target" ]; then
  exit 0
fi

# ブロック対象パターン
patterns=(
  # クレデンシャルファイル
  '\.aws/credentials'
  '\.aws/config'
  '\.ssh/id_'
  '\.ssh/.*\.key'
  '\.netrc'
  '\.git-credentials'
  '\.npmrc'
  '\.pypirc'
  '\.docker/config\.json'
  '\.kube/config'
  '\.config/gcloud'
  '\.gcloud/'
  '\.config/gh/hosts'
  # 環境変数・シークレット
  '\.env(\.|$)'
  'secrets/'
  '/secrets\b'
  'credentials\.json'
  'service-account.*\.json'
  'firebase-adminsdk.*\.json'
  # 鍵ファイル
  '\.pem\b'
  '\.key\b'
  '\.p12$'
  '\.pfx$'
)

# Bash の場合は環境変数ダンプ系もブロック
if [ "$tool_name" = "Bash" ]; then
  bash_only_patterns=(
    '^env$'
    '^env '
    '^printenv'
    '\bps +aux\b'
    '\bps +-ef\b'
  )
  for p in "${bash_only_patterns[@]}"; do
    if echo "$target" | grep -qE "$p"; then
      echo "Blocked by block-credentials hook: 環境変数 / プロセス情報のダンプコマンドは禁止されています (pattern: $p)" >&2
      exit 2
    fi
  done
fi

for p in "${patterns[@]}"; do
  if echo "$target" | grep -qE "$p"; then
    echo "Blocked by block-credentials hook: クレデンシャル・機密ファイルへのアクセスは禁止されています (pattern: $p)" >&2
    exit 2
  fi
done

exit 0
