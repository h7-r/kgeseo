import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { najuEditFile } from "./vite/editFilePlugin";

// NAJU-01 그레이박스 전용 개발 서버. 본편과 같은 node_modules 를 쓴다.
//   실행: npx vite naju01 → http://localhost:5174 · 빌드: npx vite build naju01
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // 3D 에셋·글꼴은 본편 public/ 한 벌을 같이 쓴다 — 두 벌이면 어느 쪽이 최신인지 금방 어긋난다
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  server: {
    port: 5174,
    // 물려 있으면 옮겨 붙지 않고 실패한다 — 포트가 바뀌면 출처가 달라져 Leva 저장값이 사라진 것처럼 보인다
    strictPort: true,
    // 본편 engine(저장소 src/)을 읽는다
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  build: { outDir: "dist-naju01", emptyOutDir: true },
  plugins: [react(), najuEditFile({ writable: true })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
});
