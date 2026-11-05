/**
 * 통발 퍼즐 진행 — 씬1 도입. 그날 밤 꺼진 화톳불의 불티가 「빛 물고기」가 되어 강을 헤맨다.
 *   idle   통발 셋을 물에 넣는다. 하나만 입구가 물살을 봐서 불씨가 든다
 *   full   불씨로 찼다 — 그 통발 줄만 파르르 떨린다
 *   pulled 맞는 줄을 당겨 통발이 화톳불 곁으로 올라왔다
 *   lit    불씨를 쏟아 화톳불이 다시 붙었다 — 연기가 피어오른다
 *   told   연기가 약속의 말을 쓰고 아비사 쪽으로 흘러갔다
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

export type FishTrapStage = "idle" | "full" | "pulled" | "lit" | "told";

/** 통발이 「찼다」고 보는 불씨 수 — 물고기가 드물게 보이므로 20~30초 안에 차게 */
export const FULL_COUNT = 7;

const ORDER: FishTrapStage[] = ["idle", "full", "pulled", "lit", "told"];

const signal = createChangeSignal();
let stage: FishTrapStage = "idle";
/** 연기 화살표가 바위틈을 지나 앞서갔나 — 이때 다음 스테이지가 열린다 */
let isGuideAhead = false;

/** 앞으로만 간다 — 같은 단계를 두 번 알리지 않는다 */
function advance(next: FishTrapStage) {
  if (ORDER.indexOf(next) !== ORDER.indexOf(stage) + 1) return;
  stage = next;
  signal.notify();
}

export const fishTrapPuzzle = {
  stage: () => stage,
  subscribe: signal.subscribe,
  fill: () => advance("full"),
  pull: () => advance("pulled"),
  light: () => advance("lit"),
  tell: () => advance("told"),
  guideAhead: () => isGuideAhead,
  markGuideAhead() {
    if (isGuideAhead || stage !== "told") return;
    isGuideAhead = true;
    signal.notify();
  },
  reset() {
    stage = "idle";
    isGuideAhead = false;
    signal.notify();
  },
  /** 저장본을 넣는다. 지나간 단계의 연출은 다시 돌리지 않는다 */
  restore(saved: { stage: FishTrapStage; isGuideAhead: boolean }) {
    stage = saved.stage;
    isGuideAhead = saved.isGuideAhead;
    signal.notify();
  },
};

export const useFishTrapStage = () => useSyncExternalStore(signal.subscribe, fishTrapPuzzle.stage);

exposeDevHook("najuFishTrap", fishTrapPuzzle);
