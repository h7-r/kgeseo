/**
 * 조개 미끼 — 통발에 넣을 미끼는 직접 캐야 한다.
 *   buried  배 옆 모래 속에서 빛이 샌다(맨손으로는 못 판다)
 *   hoe     호미를 들었다
 *   dug     파냈다 — 조개가 드러났다(호미는 구덩이 옆에 내려놓는다)
 *   held    조개를 주웠다
 *   baiting 통발 입구로 넣는 중 — 다 들어가면 통발이 굴러간다
 *   baited  통발에 미끼로 넣었다
 */
import { useSyncExternalStore } from "react";
import type * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

export type ClamStage = "buried" | "hoe" | "dug" | "held" | "baiting" | "baited";

/** 미끼가 들어갈 통발 — 매 프레임 갱신되는 통발 가운데와 막힌 끝(입구는 그 반대쪽) */
interface BaitTrap {
  center: THREE.Vector3;
  closedEnd: THREE.Vector3;
}

const signal = createChangeSignal();
let stage: ClamStage = "buried";
let baitTrap: BaitTrap | null = null;

export const clamDig = {
  stage: () => stage,
  subscribe: signal.subscribe,
  set(next: ClamStage) {
    if (next === stage) return;
    stage = next;
    signal.notify();
  },
  baitTrap: () => baitTrap,
  /** 손에 든 조개를 이 통발에 넣기 시작한다 */
  putInto(trap: BaitTrap) {
    baitTrap = trap;
    clamDig.set("baiting");
  },
};

export const useClamStage = () => useSyncExternalStore(signal.subscribe, clamDig.stage);

exposeDevHook("najuClam", clamDig);
