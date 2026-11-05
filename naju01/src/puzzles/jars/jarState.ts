/**
 * 장독대 항아리 — 기우제 제물 「쌀」을 찾는 퍼즐.
 *   locked  항아리 여섯 중 가장 큰 것의 뚜껑이 꼭 닫혀 있다. 빗방울이 8초마다 자리 왼쪽부터 하나씩 친다
 *   open    빗방울이 정답 가락을 치게 늘어놓아(서버 판정) 뚜껑이 열렸다 — 안의 쌀을 챙길 수 있다
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

export type JarStage = "locked" | "open";

const signal = createChangeSignal();
let stage: JarStage = "locked";

export const jarPuzzle = {
  stage: () => stage,
  subscribe: signal.subscribe,
  open() {
    if (stage === "open") return;
    stage = "open";
    signal.notify();
  },
  reset() {
    stage = "locked";
    signal.notify();
  },
};

export const useJarStage = () => useSyncExternalStore(signal.subscribe, jarPuzzle.stage);

exposeDevHook("najuJars", jarPuzzle);
