import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

import { defaultLookReceiverPlugin } from "./naju01/vite/defaultLookPlugin";
import { dropLocalOnlyPlugin } from "./naju01/vite/dropLocalOnlyPlugin";
import { editFileServerPlugin } from "./naju01/vite/editFilePlugin";
import { sharedAssetBuildPlugin } from "./tools/shared-asset-build.mjs";
import { lobbyBuildPlugin } from "./vite.lobby-standins";

/**
 * leva 의 useValuesForPath 는 자기 폴더 값 몇 개를 읽으려고 스토어 전체(본부실 1,190개)를 매번 복사한다.
 * 구독자 96개가 스토어가 바뀔 때마다·리렌더마다 돌아 슬라이더 한 칸에 전체 복사가 약 185번 — 끌면 5fps 로 떨어졌다.
 * paths 가 전부 s.data 에 있으면 병합 결과와 pick 결과가 같으므로, 그때만 복사 없이 바로 읽는다.
 * node_modules 를 직접 고치면 npm i 에 날아가서 플러그인으로 한다. 고칠 자리를 못 찾으면 빌드를 실패시킨다
 * (조용히 안 먹는 것이 제일 나쁘다). 빌드는 vite 플러그인이, 개발 서버의 사전 번들은 rolldown 플러그인이 고친다.
 */
const LEVA_FILE = "/leva/dist/leva.esm.js";

/** 고친 leva 소스. 이 파일이 아니면 null, 고칠 자리를 못 찾으면 오류 문구 */
function patchLevaSelector(code: string, id: string): { code: string } | { error: string } | null {
  if (!id.includes(LEVA_FILE)) return null;
  const original =
    "const data = _objectSpread2(_objectSpread2({}, initialData), s.data);\n" +
    "    return getValuesForPaths(data, paths);";
  const patched =
    "for (let i = 0; i < paths.length; i++) {\n" +
    "      if (!Object.prototype.hasOwnProperty.call(s.data, paths[i])) {\n" +
    "        return getValuesForPaths(_objectSpread2(_objectSpread2({}, initialData), s.data), paths);\n" +
    "      }\n" +
    "    }\n" +
    "    return getValuesForPaths(s.data, paths);";
  if (!code.includes(original))
    return { error: "[leva-selector-patch] 고칠 자리를 못 찾았다 — leva 판이 바뀌었는지 보라" };
  return { code: code.replace(original, patched) };
}

function levaSelectorPatch(): Plugin {
  return {
    name: "leva-selector-patch",
    enforce: "pre",
    transform(code, id) {
      const result = patchLevaSelector(code, id);
      if (!result) return null;
      if ("error" in result) this.error(result.error);
      return { code: result.code, map: null };
    },
  };
}

/**
 * 개발 서버는 leva 를 의존성 사전 번들(rolldown)로 내준다 — 거기에는 위 vite 플러그인이 끼지 않아
 * 개발 중에는 고친 판이 아니었다(본부실에서 상태가 바뀔 때마다 Leva 스토어 전체 복사로 끊겼다). 사전 번들에도 같은 고침을 건다.
 */
function levaSelectorPrebundlePatch() {
  return {
    name: "leva-selector-patch-prebundle",
    transform(code: string, id: string) {
      const result = patchLevaSelector(code, id);
      if (!result) return null;
      if ("error" in result) throw new Error(result.error);
      return { code: result.code };
    },
  };
}

export default defineConfig({
  // 텔레포트가 본편 안의 /naju01/ 로 넘어가므로 이 서버도 나주 손 배치를 내준다(저장은 나주 서버 5174 에서만)
  plugins: [
    sharedAssetBuildPlugin(),
    lobbyBuildPlugin(),
    levaSelectorPatch(),
    react(),
    editFileServerPlugin({ writable: false }),
    defaultLookReceiverPlugin(),
    dropLocalOnlyPlugin(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // 기차에서 고른 나주(/naju01/)를 이 서버가 내줄 때 동행 NPC 가 쓰는 경로 — naju01/vite.config.ts 와 같게.
      // 없으면 「전설 속으로」 뒤 나주가 「@npc/behaviorState 를 못 찾음」으로 멈춘다(배포 빌드는 나주 설정으로 따로 빌드해 괜찮았다)
      "@npc": fileURLToPath(new URL("./prototypes/npc-follow/src/npc", import.meta.url)),
    },
  },
  // 본편·나주 의존성을 서버 켤 때 한 번에 묶는다 — 나주 첫 진입 때 다시 묶으며 새로고침하는 긴 멈춤을 없앤다
  optimizeDeps: {
    entries: ["index.html", "naju01/index.html"],
    rolldownOptions: { plugins: [levaSelectorPrebundlePatch()] },
  },
  server: {
    // 5174(나주)로 옮겨 붙으면 출처가 달라져 Leva 저장값이 사라진 것처럼 보인다 — 물려 있으면 실패한다
    port: 5173,
    strictPort: true,
    // 나주 모듈은 많고 무거워 첫 요청에 변환하느라 멈춘다 — 서버 켤 때 미리 변환해 둔다
    warmup: {
      clientFiles: ["./naju01/src/main.tsx", "./naju01/src/scene/NajuScene.tsx"],
    },
    // 백엔드(FastAPI, backend/)
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
