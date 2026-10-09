import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { editFileBundlePlugin, editFileServerPlugin } from "./vite/editFilePlugin";

// NAJU-01 그레이박스 전용 개발 서버. 본편과 같은 node_modules 를 쓴다.
//   실행: npx vite naju01 → http://localhost:5174
//   빌드: npx vite build naju01 → naju01/dist-naju01/ · 보기: npx vite preview naju01
//   발표는 빌드본이 낫다 — HMR·미압축 모듈·개발용 검사가 빠져 첫 진입과 프레임이 둘 다 가볍다.
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
    // 개발 서버는 요청이 와야 변환한다. 모듈이 많고 구운 모형 모듈이 커서 미리 데우지 않으면 첫 진입이 몇 초 멈춘다.
    // 3인칭 캐릭터 둘은 V 를 누를 때 늦게 실려(lazy) 그때 한 번 멈추므로 같이 데운다.
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/scene/NajuScene.tsx",
        "./src/avatar/ChibiGameAvatar.tsx",
        "./src/avatar/SidekickGameAvatar.tsx",
      ],
    },
  },
  build: {
    outDir: "dist-naju01",
    emptyOutDir: true,
    // three·drei·postprocessing 은 원래 크다 — 경고만 조용히 한다
    chunkSizeWarningLimit: 4000,
  },
  plugins: [react(), editFileServerPlugin({ writable: true }), editFileBundlePlugin()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
});
