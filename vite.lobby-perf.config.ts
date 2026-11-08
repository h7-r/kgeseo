// 로비 0단계 화면 성능 예비 측정 전용 개발 서버(설계 v0.19 6절). 배포 빌드와 상관없다.
//   npx vite --config vite.lobby-perf.config.ts   → http://localhost:5180/?bots=9&input=always
// 기존 vite.config.ts 를 그대로 쓰고, src/app/App.tsx 가 가져오는 `@react-three/fiber` 하나만
// 가짜 아바타를 덧붙인 대역(src/dev/lobbyPerf/r3fWithBots.tsx)으로 돌린다. 다른 파일의 R3F 는 그대로다.
// 절차·기록표: docs/로비/0단계-화면성능-측정.md
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeConfig, type Plugin } from "vite";

import baseConfig from "./vite.config";

/**
 * 기록표의 「후보 커밋」(설계 7.4). 추적 중인 파일을 고쳤거나 src/·shared/ 에 커밋 안 한 새 파일이 있으면 +수정을 붙인다.
 * 그 밖의 추적 안 된 폴더(다른 사람 작업 중인 에셋 등)는 이 빌드가 읽지 않으므로 보지 않는다.
 */
function readCommit(): string {
  const git = (args: string) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
  try {
    const hash = git("rev-parse --short HEAD");
    const dirty =
      git("status --porcelain --untracked-files=no") !== "" ||
      git("status --porcelain --untracked-files=all -- src shared") !== "";
    return dirty ? `${hash}+수정` : hash;
  } catch {
    return "알 수 없음";
  }
}

const APP_FILE = fileURLToPath(new URL("./src/app/App.tsx", import.meta.url));
const STAND_IN_FILE = fileURLToPath(new URL("./src/dev/lobbyPerf/r3fWithBots.tsx", import.meta.url));

function lobbyPerfCanvasPlugin(): Plugin {
  return {
    name: "lobby-perf-canvas",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "@react-three/fiber" || !importer) return null;
      return importer.split("?")[0] === APP_FILE ? STAND_IN_FILE : null;
    },
  };
}

export default mergeConfig(baseConfig, {
  plugins: [lobbyPerfCanvasPlugin()],
  define: { __LOBBY_PERF_COMMIT__: JSON.stringify(readCommit()) },
  // 평소 개발 서버(5173)와 같이 띄워도 사전 번들·포트가 부딪히지 않게 따로 둔다.
  // 출처가 달라 저장값(위치·외형·설정)이 비어 있는 상태로 시작한다 — 측정마다 조건이 같아진다.
  cacheDir: "node_modules/.vite-lobby-perf",
  server: { port: 5180 },
  // 판정용 숫자는 개발 모드(React 개발판·묶지 않은 모듈)가 아니라 배포와 같은 빌드로 잰다. dist-*/ 는 Git 이 무시한다.
  build: { outDir: "dist-lobby-perf" },
  preview: { port: 5181, strictPort: true },
});
