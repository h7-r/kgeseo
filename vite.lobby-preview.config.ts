// 로비 실제 화면 미리보기 전용 개발 서버(3단계 정식 연결 전에 실제 본부실에서 로비를 눈으로 본다). 배포 빌드와 상관없다.
//   npx vite --config vite.lobby-preview.config.ts   → http://localhost:5173/?input=always
// 기존 vite.config.ts 를 그대로 쓰고, src/app/App.tsx 가 가져오는 `@react-three/fiber` 하나만
// 로비 연결을 덧붙인 대역(src/dev/lobbyPreview/r3fWithLobby.tsx)으로 돌린다. 다른 파일의 R3F 는 그대로다.
// 포트는 평소와 같은 5173 이다 — 백엔드·로비가 허용한 출처(http://localhost:5173)라야 로그인·입장권·매칭이 된다.
import { fileURLToPath } from "node:url";
import { mergeConfig, type Plugin } from "vite";

import baseConfig from "./vite.config";

const APP_FILE = fileURLToPath(new URL("./src/app/App.tsx", import.meta.url));
const STAND_IN_FILE = fileURLToPath(new URL("./src/dev/lobbyPreview/r3fWithLobby.tsx", import.meta.url));

function lobbyPreviewCanvasPlugin(): Plugin {
  return {
    name: "lobby-preview-canvas",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "@react-three/fiber" || !importer) return null;
      return importer.split("?")[0] === APP_FILE ? STAND_IN_FILE : null;
    },
  };
}

export default mergeConfig(baseConfig, {
  plugins: [lobbyPreviewCanvasPlugin()],
  cacheDir: "node_modules/.vite-lobby-preview",
});
