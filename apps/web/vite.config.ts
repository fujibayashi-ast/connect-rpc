import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // shadcn/ui のコンポーネントが `@/lib/utils` のように参照するための別名（tsconfig の paths と合わせる）
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
