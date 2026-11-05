/**
 * 기우제 진행.
 *   cairns   돌탑 여섯을 마법진 홈에 맞추는 중 — 홈의 눈금 수와 돌탑의 돌 수가 같아야 빛난다
 *   drawing  여섯이 다 맞았다 — 빛이 돌탑끼리 이어지며 마법진을 그리고 마지막에 소반으로 모인다
 *   offering 소반이 빛난다 — 빛 물고기 · 쌀 · 막걸리를 올린다
 *   rising   셋 다 올렸다 — 빛기둥이 하늘로 오르고 비가 미친 듯이 쏟아진다
 *   flooded  물이 차올라 머문다 — 물 위에 돌 넷이 떠 있다
 *   parted   뜬 돌 넷을 다 건졌다 — 강물이 양쪽으로 갈라져 강 밑으로 길이 난다(puzzles/cave)
 *   cave     갈라진 물이 머리 위에서 합쳐졌다 — 물속 동굴. 숨을 아껴 가며 고리문을 푼다
 *   cleared  석실 물건을 얻고 물살에 실려 강가로 돌아왔다 — 물이 빠진다
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

export type RitualStage = "cairns" | "drawing" | "offering" | "rising" | "flooded" | "parted" | "cave" | "cleared";

const ORDER: RitualStage[] = ["cairns", "drawing", "offering", "rising", "flooded", "parted", "cave", "cleared"];

const signal = createChangeSignal();
let stage: RitualStage = "cairns";

/** 앞으로만 간다 */
function advance(next: RitualStage) {
  if (ORDER.indexOf(next) !== ORDER.indexOf(stage) + 1) return;
  stage = next;
  signal.notify();
}

export const ritual = {
  stage: () => stage,
  subscribe: signal.subscribe,
  /** 이 단계이거나 지났나 */
  isAtLeast: (at: RitualStage) => ORDER.indexOf(stage) >= ORDER.indexOf(at),
  draw: () => advance("drawing"),
  ready: () => advance("offering"),
  rise: () => advance("rising"),
  flood: () => advance("flooded"),
  part: () => advance("parted"),
  enterCave: () => advance("cave"),
  clear: () => advance("cleared"),
  /** 저장본을 넣는다 */
  restore(saved: RitualStage) {
    stage = saved;
    signal.notify();
  },
};

export const useRitualStage = () => useSyncExternalStore(signal.subscribe, ritual.stage);

/** 차오른 물 높이(미터) — 물에 뜬 돌이 매 프레임 읽는다. 물이 없으면 음수 */
let waterLevel = -1;
export const getWaterLevel = () => waterLevel;
export function setWaterLevel(level: number) {
  waterLevel = level;
}

/** 폭우 세기(0~1) — 기우제가 정하고 폭우 빗줄기가 읽는다 */
let stormRain = 0;
export const getStormRain = () => stormRain;
export function setStormRain(level: number) {
  stormRain = level;
}

exposeDevHook("najuRitual", ritual);
