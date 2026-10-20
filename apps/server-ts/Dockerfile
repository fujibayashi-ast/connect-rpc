# ビルドコンテキストはリポジトリのルート（compose.yaml 参照）。gen-ts を共有するため
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server-ts/package.json apps/server-ts/
COPY apps/web/package.json apps/web/
COPY packages/gen-ts/package.json packages/gen-ts/
COPY packages/contract-test/package.json packages/contract-test/
RUN bun install --frozen-lockfile --filter @connect-rpc/server-ts

FROM node:24-alpine
WORKDIR /app
COPY --from=deps /app ./
COPY packages/gen-ts/src packages/gen-ts/src
COPY apps/server-ts/src apps/server-ts/src
WORKDIR /app/apps/server-ts
ENV PORT=8081
EXPOSE 8081
# Node の型除去で .ts をそのまま実行する（ビルド不要）。
# gen-ts は symlink 先の実体が node_modules の外にあるので型除去の対象になる
CMD ["node", "src/main.ts"]
