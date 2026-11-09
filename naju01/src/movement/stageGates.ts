// 스테이지 경계 — 지도 전체를 빈틈없이 네 영역으로 나누고, 아직 안 열린 영역으로 넘어가는 걸음만 막는다.
// 언덕 · 절벽 · 강 · 풀숲 어디로 돌아도 영역이 다르면 막히므로 샐 틈이 없다. 이미 그 영역 안이면 자유롭게 움직인다.
// 바위 위에서는 벼랑 밖으로 나가는 걸음도 막는다 — 걸어서든 뛰어서든 떨어지지 않는다.
// 단위는 미터.

import { exposeDevHook } from "@/debug/devHooks";

import { cliffProfileAt } from "../plan/sitePlan";
import { showNotice } from "../puzzles/interaction";
import { fishTrapPuzzle } from "../puzzles/fishTrap/fishTrapState";
import { isInsideCurtain, nearestCurtainT } from "../puzzles/ridge/ridgeShape";
import { ridge } from "../puzzles/ridge/ridgeState";
import { ritual } from "../puzzles/ritual/ritualState";
import { walkTerrain } from "./playerPose";

type Region = "나루터" | "바위아래" | "능선" | "바위위";

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

function regionAt(x: number, z: number): Region {
  if (z < northEdgeAt(x)) {
    // 나루터 뒤 언덕은 낙석 앞까지만 — 더 올라가면 절벽 위 영역이다
    if (x < DOCK_NORTH_EDGE_X && z >= DOCK_HILL_END_Z) return "나루터";
    return x < RIDGE_NORTH_EDGE_X ? "바위위" : "능선";
  }
  if (x < DOCK_EDGE_X) return "나루터";
  return x < RIDGE_EDGE_X ? "바위아래" : "능선";
}

const IS_REGION_OPEN: Record<Region, () => boolean> = {
  나루터: () => true,
  // 연기 화살표가 앞서 바위틈을 지나면 열린다. 기우제를 시작했으면 이미 지나온 것이다(이어 하기)
  바위아래: () => fishTrapPuzzle.guideAhead() || ritual.isAtLeast("drawing"),
  // 물굴에서 비늘을 얻고 강가로 돌아오면 열린다
  능선: () => ritual.isAtLeast("cleared"),
  // 능선의 시공간 틈을 지나면 열린다
  바위위: () => ridge.isAtLeast("done"),
};

function closedNotice(region: Region) {
  if (region === "바위아래")
    return fishTrapPuzzle.stage() === "told"
      ? "연기가 아직 뒤에 있다. 화살표가 앞서가길 기다렸다 따라가자."
      : "바위틈 너머는 아직이다. 나루터에서 할 일이 남았다.";
  if (region === "능선") return "강변 비탈은 아직이다. 바위 아래에서 할 일이 남았다.";
  return "바위가 막아 위로 오를 길이 없다.";
}

/**
 * 벼랑 끝 — 바위 위(이 높이 위)에 서 있을 때, 가려는 쪽 바로 앞(ahead)에서 땅이 이만큼 넘게 꺼지면 낭떠러지다.
 * 내려가는 길(경사로)은 한 걸음 앞이 이만큼 꺼지지 않아 그대로 지나간다
 */
const CLIFF_GUARD = { from: 12, ahead: 1.0, drop: 1.5, step: 0.6 };
function isCliffDropAt(x: number, z: number, fromX: number, fromZ: number) {
  const terrain = walkTerrain.current;
  if (!terrain) return false;
  const standing = terrain.groundAt(fromX, fromZ).y;
  if (standing < CLIFF_GUARD.from) return false;
  if (terrain.groundAt(x, z).y < standing - CLIFF_GUARD.step) return true;
  const length = Math.hypot(x - fromX, z - fromZ);
  if (length < 1e-5) return false;
  const aheadX = x + ((x - fromX) / length) * CLIFF_GUARD.ahead;
  const aheadZ = z + ((z - fromZ) / length) * CLIFF_GUARD.ahead;
  return terrain.groundAt(aheadX, aheadZ).y < standing - CLIFF_GUARD.drop;
}

const NOTICE_GAP_MS = 6000;
const noticedAt = new Map<string, number>();
function noticeOnce(name: string, text: string) {
  const now = performance.now();
  if (now - (noticedAt.get(name) ?? -Infinity) < NOTICE_GAP_MS) return;
  noticedAt.set(name, now);
  showNotice(text, 3.5);
}

/** 개발용 — 문을 다 연다(퍼즐을 건너뛰고 뒤 스테이지를 볼 때) */
let isForcedOpen = false;

const CURTAIN_NOTICE = "바람 장막이 몸을 밀어낸다. 돌새들의 눈이 맞기 전엔 능선을 벗어날 수 없다.";

/** 지금 자리(from)에서 그 자리로 갈 수 없나. 막히면 안내를 띄운다 */
export function gateBlockedAt(x: number, z: number, fromX: number, fromZ: number): boolean {
  // 증언 능선의 바람 장막 — 내려가는 길·올라가는 길·떨어지는 비탈 모두 장막 밖이다
  if (ridge.isConfining() && !isInsideCurtain(x, z, 0.6)) {
    // 부딪힌 자리에서 장막이 물결친다(0.3 초에 한 번만 잰다)
    if (performance.now() / 1000 - ridge.lastTouch().at > 0.3) ridge.touchCurtain(nearestCurtainT(x, z));
    noticeOnce("장막", CURTAIN_NOTICE);
    return true;
  }
  if (isCliffDropAt(x, z, fromX, fromZ)) {
    noticeOnce("벼랑", "벼랑 끝이다. 더 나가면 떨어진다.");
    return true;
  }
  if (isForcedOpen) return false;
  const to = regionAt(x, z);
  const from = regionAt(fromX, fromZ);
  // 닫힌 영역 안에서 시작했으면(이어 하기 · 개발용 순간이동) 막지 않는다 — 나갈 곳이 없어 갇힌다
  if (to === from || IS_REGION_OPEN[to]() || !IS_REGION_OPEN[from]()) return false;
  noticeOnce(to, closedNotice(to));
  return true;
}

exposeDevHook("najuGates", {
  list: () => (Object.keys(IS_REGION_OPEN) as Region[]).map((name) => ({ name, open: IS_REGION_OPEN[name]() })),
  regionAt,
  isBlocked: gateBlockedAt,
  openAll: () => {
    isForcedOpen = true;
  },
  closeAll: () => {
    isForcedOpen = false;
  },
});
