// 로비 대역 — src/app/App.tsx 가 가져오는 두 가지와 usePlayer.ts 의 충돌 하나를 로비판으로 돌린다.
//   `@react-three/fiber` → src/dev/lobbyPreview/r3fWithLobby.tsx (로비 연결을 덧붙인 Canvas)
//   `./playerState`      → src/dev/lobbyPreview/playerStateWithLobby.ts (내 플레이어 상자를 로비에 등록 — 인사·맞기 동작)
//   usePlayer.ts 의 `./collision` → collisionWithPeople.ts (내 걷기에만 사람 충돌)
// 쓰는 곳 두 군데:
//   vite.lobby-preview.config.ts — 개발 미리보기(늘 켬)
//   vite.config.ts — 배포 빌드에서 VITE_LOBBY_URL 이 있을 때만(11/8 미르: 베타테스터용 로비를 운영에 켠다). 비면 지금처럼 혼자 모드 빌드
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const APP_FILE = fileURLToPath(new URL("./src/app/App.tsx", import.meta.url));
const STAND_IN_FILE = fileURLToPath(new URL("./src/dev/lobbyPreview/r3fWithLobby.tsx", import.meta.url));
const PLAYER_STATE_STAND_IN = fileURLToPath(new URL("./src/dev/lobbyPreview/playerStateWithLobby.ts", import.meta.url));
const USE_PLAYER_FILE = fileURLToPath(new URL("./src/station/layout/usePlayer.ts", import.meta.url));
const COLLISION_STAND_IN = fileURLToPath(new URL("./src/dev/lobbyPreview/collisionWithPeople.ts", import.meta.url));

function resolveStandIn(source: string, importer: string | undefined): string | null {
  const from = importer?.split("?")[0];
  if (from === APP_FILE) {
    if (source === "@react-three/fiber") return STAND_IN_FILE;
    if (source === "./playerState") return PLAYER_STATE_STAND_IN;
  }
  if (from === USE_PLAYER_FILE && source === "./collision") return COLLISION_STAND_IN;
  return null;
}

/** 개발 미리보기 — 늘 대역 */
export function lobbyPreviewCanvasPlugin(): Plugin {
  return {
    name: "lobby-preview-canvas",
    enforce: "pre",
    resolveId: (source, importer) => resolveStandIn(source, importer),
  };
}

/** 배포 빌드 — VITE_LOBBY_URL(빌드 환경값 · .env*)이 있을 때만 대역. 없으면 아무것도 바꾸지 않는다 */
export function lobbyBuildPlugin(): Plugin {
  let enabled = false;
  return {
    name: "lobby-build-stand-ins",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      enabled = typeof config.env.VITE_LOBBY_URL === "string" && config.env.VITE_LOBBY_URL.trim() !== "";
      config.logger.info(`[lobby] 배포 빌드 로비 ${enabled ? "켬 — " + config.env.VITE_LOBBY_URL : "끔(VITE_LOBBY_URL 없음)"}`);
    },
    resolveId: (source, importer) => (enabled ? resolveStandIn(source, importer) : null),
  };
}
