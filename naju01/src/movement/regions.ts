// 스테이지 영역 — 지도 전체를 빈틈없이 네 영역으로 나눈다(stageGates 가 넘나드는 걸음을 막는다). 부작용 없는 판정만.
// 문(stageGates)과 놓고 온 물건 안내(puzzles/leftBehind)가 같이 쓴다 — 서로를 부르지 않게 따로 뒀다(튜토피드백 13회차 Codex).
// 단위는 미터.

import { cliffProfileAt } from "../plan/sitePlan";

export type Region = "나루터" | "바위아래" | "능선" | "바위위";

/** 절벽 위 영역이 시작되는 z(이 값보다 북쪽) — 절벽 발치 안쪽은 아래에서 발을 못 댄다 */
function northEdgeAt(x: number) {
  if (x < CLIFF_X[0]) return WEST_NORTH_EDGE;
  return x <= CLIFF_X[1] ? cliffProfileAt(x).toe : EAST_NORTH_EDGE;
}
const CLIFF_X = [34, 56] as const;
const WEST_NORTH_EDGE = 29.5;
const EAST_NORTH_EDGE = 29;
/** 나루터 ↔ 바위 아래 · 절벽 위 ↔ 나루터 · 바위 아래 ↔ 능선의 경계 x */
const DOCK_EDGE_X = 30;
const DOCK_NORTH_EDGE_X = 31.4;
const DOCK_HILL_END_Z = 20;
const RIDGE_EDGE_X = 57;
const RIDGE_NORTH_EDGE_X = 58;

export function regionAt(x: number, z: number): Region {
  if (z < northEdgeAt(x)) {
    // 나루터 뒤 언덕은 낙석 앞까지만 — 더 올라가면 절벽 위 영역이다
    if (x < DOCK_NORTH_EDGE_X && z >= DOCK_HILL_END_Z) return "나루터";
    return x < RIDGE_NORTH_EDGE_X ? "바위위" : "능선";
  }
  if (x < DOCK_EDGE_X) return "나루터";
  return x < RIDGE_EDGE_X ? "바위아래" : "능선";
}
