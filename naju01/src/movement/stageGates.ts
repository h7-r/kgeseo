// 스테이지 문 — 앞 스테이지 퍼즐을 풀기 전에는 다음 스테이지 쪽으로 못 넘어간다.
// 나루터(Z1)와 바위 아래(Z2) 사이는 바위틈(T1)만이 아니라 강가까지 평지로 트여 있어, 바위 능선 끝에서 물가까지 한 줄로 막는다.
// 바위 아래(Z2)에서 강변 비탈(T2)로 오르는 들머리도 같은 식이다. Z3 로 가는 두 길은 도면 차단물(B2·B4)이 이미 막고 있다.
// 막히면 안내를 한 번 띄운다(같은 문은 6 초에 한 번). 단위는 미터.

import { exposeDevHook } from "@/debug/devHooks";

import { showNotice } from "../puzzles/interaction";
import { fishTrapPuzzle } from "../puzzles/fishTrap/fishTrapState";
import { isInsideCurtain, nearestCurtainT } from "../puzzles/ridge/ridgeShape";
import { ridge } from "../puzzles/ridge/ridgeState";
import { ritual } from "../puzzles/ritual/ritualState";

interface StageGate {
  name: string;
  x: [number, number];
  z: [number, number];
  isOpen: () => boolean;
  notice: string;
}

const GATES: StageGate[] = [
  {
    // 연기가 화살표로 모여 길을 이끌기 시작하면 열린다
    name: "나루터 → 바위 아래",
    x: [30.0, 31.0],
    z: [27.5, 44.6],
    isOpen: () => fishTrapPuzzle.stage() === "told",
    notice: "바위틈 너머는 아직이다. 나루터에서 할 일이 남았다.",
  },
  {
    // 물굴에서 비늘을 얻고 강가로 돌아오면 열린다
    name: "바위 아래 → 강변 비탈",
    x: [57.0, 58.0],
    z: [26.0, 44.6],
    isOpen: () => ritual.isAtLeast("cleared"),
    notice: "강변 비탈은 아직이다. 바위 아래에서 할 일이 남았다.",
  },
];

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

/** 그 자리가 아직 닫힌 문 안인가. 닫혀 있으면 안내를 띄운다 */
export function gateBlockedAt(x: number, z: number): boolean {
  // 증언 능선의 바람 장막 — 내려가는 길·올라가는 길·떨어지는 비탈 모두 장막 밖이다
  if (ridge.isConfining() && !isInsideCurtain(x, z, 0.6)) {
    // 부딪힌 자리에서 장막이 물결친다(0.3 초에 한 번만 잰다)
    if (performance.now() / 1000 - ridge.lastTouch().at > 0.3) ridge.touchCurtain(nearestCurtainT(x, z));
    noticeOnce("장막", CURTAIN_NOTICE);
    return true;
  }
  if (isForcedOpen) return false;
  for (const gate of GATES) {
    if (x < gate.x[0] || x > gate.x[1] || z < gate.z[0] || z > gate.z[1] || gate.isOpen()) continue;
    noticeOnce(gate.name, gate.notice);
    return true;
  }
  return false;
}

exposeDevHook("najuGates", {
  list: () => GATES.map((gate) => ({ name: gate.name, open: gate.isOpen() })),
  openAll: () => {
    isForcedOpen = true;
  },
  closeAll: () => {
    isForcedOpen = false;
  },
});
