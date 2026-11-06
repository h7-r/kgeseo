// 로비 실제 화면 미리보기 전용 개발 서버(3단계 정식 연결 전에 실제 본부실에서 로비를 눈으로 본다). 배포 빌드와 상관없다.
//   npx vite --config vite.lobby-preview.config.ts   → http://localhost:5173/?input=always
// 기존 vite.config.ts 를 그대로 쓰고, src/app/App.tsx 가 가져오는 두 가지만 대역으로 돌린다. 다른 파일은 그대로다.
//   `@react-three/fiber` → src/dev/lobbyPreview/r3fWithLobby.tsx (로비 연결을 덧붙인 Canvas)
//   `./playerState`      → src/dev/lobbyPreview/playerStateWithLobby.ts (내 플레이어 상자를 미리보기에 등록 — 인사·맞기 동작)
// 그리고 src/station/layout/usePlayer.ts 가 가져오는 `./collision` 하나를 collisionWithPeople.ts 로(내 걷기에만 사람 충돌).
// 포트는 평소와 같은 5173 이다 — 백엔드·로비가 허용한 출처(http://localhost:5173)라야 로그인·입장권·매칭이 된다.
import { fileURLToPath } from "node:url";
import { mergeConfig, type Plugin } from "vite";

import baseConfig from "./vite.config";

const APP_FILE = fileURLToPath(new URL("./src/app/App.tsx", import.meta.url));
const STAND_IN_FILE = fileURLToPath(new URL("./src/dev/lobbyPreview/r3fWithLobby.tsx", import.meta.url));
const PLAYER_STATE_STAND_IN = fileURLToPath(new URL("./src/dev/lobbyPreview/playerStateWithLobby.ts", import.meta.url));
const USE_PLAYER_FILE = fileURLToPath(new URL("./src/station/layout/usePlayer.ts", import.meta.url));
const COLLISION_STAND_IN = fileURLToPath(new URL("./src/dev/lobbyPreview/collisionWithPeople.ts", import.meta.url));

function lobbyPreviewCanvasPlugin(): Plugin {
  return {
    name: "lobby-preview-canvas",
    enforce: "pre",
    resolveId(source, importer) {
      const from = importer?.split("?")[0];
      if (from === APP_FILE) {
        if (source === "@react-three/fiber") return STAND_IN_FILE;
        if (source === "./playerState") return PLAYER_STATE_STAND_IN;
      }
      if (from === USE_PLAYER_FILE && source === "./collision") return COLLISION_STAND_IN;
      return null;
    },
  };
}

export default mergeConfig(baseConfig, {
  plugins: [lobbyPreviewCanvasPlugin()],
  cacheDir: "node_modules/.vite-lobby-preview",
});
