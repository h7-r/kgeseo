// 스테이지 경계 — 지도 전체를 빈틈없이 네 영역으로 나누고, 아직 안 열린 영역으로 넘어가는 걸음만 막는다.
// 언덕 · 절벽 · 강 · 풀숲 어디로 돌아도 영역이 다르면 막히므로 샐 틈이 없다. 이미 그 영역 안이면 자유롭게 움직인다.
// 바위 위에서는 벼랑 밖으로 나가는 걸음도 막는다 — 걸어서든 뛰어서든 떨어지지 않는다.
// 단위는 미터.

import { exposeDevHook } from "@/debug/devHooks";

import { showNotice } from "../puzzles/interaction";
import { fishTrapPuzzle } from "../puzzles/fishTrap/fishTrapState";
import { hasUnofferedOfferingAtDock, isDockGateHeldByFish, reportDockGateBlocked } from "../puzzles/leftBehind";
import { isInsideCurtain, nearestCurtainT } from "../puzzles/ridge/ridgeShape";
import { ridge } from "../puzzles/ridge/ridgeState";
import { ritual } from "../puzzles/ritual/ritualState";
import { walkTerrain } from "./playerPose";
import { regionAt, type Region } from "./regions";

const IS_REGION_OPEN: Record<Region, () => boolean> = {
  나루터: () => true,
  // 연기 화살표가 앞서 바위틈을 지나면 열린다. 기우제를 시작했으면 이미 지나온 것이다(이어 하기).
  // 처음 넘어갈 때 씬 1의 빛 물고기를 나루터 땅에 두고 왔으면 안 열린다 — 동행이 「뭐 놓친 거 없어요?」(puzzles/leftBehind, 튜토피드백 13회차)
  바위아래: () => (fishTrapPuzzle.guideAhead() && !isDockGateHeldByFish()) || ritual.isAtLeast("drawing"),
  // 물굴에서 비늘을 얻고 강가로 돌아오면 열린다
  능선: () => ritual.isAtLeast("cleared"),
  // 능선의 시공간 틈을 지나면 열린다
  바위위: () => ridge.isAtLeast("done"),
};

function closedNotice(region: Region) {
  if (region === "바위아래" && fishTrapPuzzle.guideAhead() && isDockGateHeldByFish()) {
    reportDockGateBlocked(); // 말은 CompanionNudge 가 차례가 나면 — 여기서는 청하기만
    return "바위틈 앞에서 동행이 발을 멈춘다. 나루터에 두고 온 것이 있는 것 같다.";
  }
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
  // 지금 부딪힌 것에 대한 반응 — 바로, 이야기 중이라 못 뜨면 버린다(경계가 풀린 뒤에 뜨면 지난 말)
  showNotice(text, 3.5, { urgent: true, fleeting: true });
}

/** 개발용 — 문을 다 연다(퍼즐을 건너뛰고 뒤 스테이지를 볼 때) */
let isForcedOpen = false;

const CURTAIN_NOTICE = "바람 장막이 몸을 밀어낸다. 돌새들의 눈이 맞기 전엔 능선을 벗어날 수 없다.";
const BACK_TO_DOCK_NOTICE = "나루터 일은 다 마쳤다. 지나온 길로 돌아가지 말고 앞으로 가자.";

/**
 * 지나온 나루터로는 돌아가지 않는다(미르 11/11) — 바위 아래가 열려(나루터 일을 다 마치고) 넘어온 뒤에는 나루터로 들어서는 걸음을 막는다.
 * 물이 차오른 바위 아래를 나루터 쪽에서 다시 보면 연출이 깨졌다. 지금 자리(넘어와 있음)가 곧 「정상 진입」이라 저장 표시는 필요 없다.
 * 안 올린 제물이 나루터 땅에 남아 있으면 열어 둔다(갇히지 않게). 능선 · 바위 위의 되돌아가기는 아직 막지 않는다 — 앞 영역 물건(푸른 눈물 ·
 * 편지함 · 구렁이상)을 넘겨주는 길이 다 막혀 있지 않다(나주지역막기 01회차 Codex)
 */
const isBackToDockBlocked = (to: Region, from: Region) =>
  to === "나루터" && from !== "나루터" && IS_REGION_OPEN.바위아래() && !hasUnofferedOfferingAtDock();

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
  if (to !== from && isBackToDockBlocked(to, from) && IS_REGION_OPEN[from]()) {
    noticeOnce("지나온 나루터", BACK_TO_DOCK_NOTICE);
    return true;
  }
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
