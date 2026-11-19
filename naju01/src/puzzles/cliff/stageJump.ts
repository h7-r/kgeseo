/**
 * `?stage=4` — 1~3스테이지를 다 깬 상태로 바위 위(4스테이지)에서 시작한다. 개발 서버에서만(시험 · 시연용).
 * `?stage=cave` — 기우제까지 마치고 강이 갈라진 뒤, 강 밑 길 끝(물이 머리 위에서 닫히는 곳)에서 시작한다 — 물굴만 볼 때(미르 11/12).
 *   자리 옮기기는 CaveWorld 가 한다.
 * 화면이 처음 그려지기 전에(이 모듈을 읽는 순간) 앞 스테이지 상태를 넣어야 각 퍼즐이 「이어 하기」로 알고 지난 연출을 다시 틀지 않는다.
 *   1스테이지 통발 — 연기 화살표까지 · 2스테이지 항아리 — 푼 차례로 놓이고 뚜껑이 열림 · 배의 막걸리 — 챙겨 감 · 기우제 · 물굴 — 강가로 돌아옴
 *   3스테이지 능선 — 시공간 틈을 건넘
 *   소지품 — 앞에서 얻은 것은 다 쓰였다(제물 · 뜬 돌 · 톱니돌 · 큰 진주 · 푸른 눈물 · 청동 열쇠). 연 함에서 꺼낸 구렁이상만 남는다.
 */
import { remember } from "../../save/puzzleMemory";
import { fishTrapPuzzle } from "../fishTrap/fishTrapState";
import { inventory } from "../inventory";
import { jarPuzzle } from "../jars/jarState";
import { makgeolliBottle } from "../makgeolli/makgeolliState";
import { ridge, ridgeQuest } from "../ridge/ridgeState";
import { ritual } from "../ritual/ritualState";

/** 시작할 때 서는 곳 — 능선의 시공간 틈이 건네주는 바위 위 들머리(GateRift)에서 만나던 자리 쪽을 본다 */
export const STAGE4_START = { x: 52, z: 11, heading: "-X" as const };

const requested = typeof location !== "undefined" ? new URLSearchParams(location.search).get("stage") : null;
export const IS_STAGE4_JUMP = import.meta.env.DEV && requested === "4";
export const IS_CAVE_JUMP = import.meta.env.DEV && requested === "cave";

// 1스테이지 · 바위 아래(항아리 · 막걸리 · 기우제)를 마치고 물굴에 막 들어섰다
if (IS_CAVE_JUMP) {
  fishTrapPuzzle.restore({ stage: "told", isGuideAhead: true });
  jarPuzzle.open();
  void import("./stageJumpJars.dev").then(({ SOLVED_JAR_ORDER }) => remember("jars.order", SOLVED_JAR_ORDER));
  makgeolliBottle.restore(true);
  ritual.restore("cave");
  inventory.reset();
}

if (IS_STAGE4_JUMP) {
  fishTrapPuzzle.restore({ stage: "told", isGuideAhead: true });
  jarPuzzle.open();
  // 항아리는 푼 차례로 놓여 있다 — 장독대가 깔리기(게임이 뜬 뒤) 전에 읽어 둔다
  if (import.meta.env.DEV)
    void import("./stageJumpJars.dev").then(({ SOLVED_JAR_ORDER }) => remember("jars.order", SOLVED_JAR_ORDER));
  makgeolliBottle.restore(true);
  ritual.restore("cleared");
  ridgeQuest.restore({ chestOnAltar: true, postsSolved: true, stairs: true, birdsFacing: true, scaleSet: true });
  ridge.restore({ stage: "done", releaseFrom: 0.25 });
  remember("ridge.isKeyThrown", true);
  remember("ridge.serpentTaken", true);
  inventory.reset();
  inventory.add("serpentFigure");
}
