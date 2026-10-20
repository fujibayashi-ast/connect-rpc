interface ImportMetaEnv {
  // 接続先のサーバー。Go: http://localhost:8080、TS: http://localhost:8081
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
