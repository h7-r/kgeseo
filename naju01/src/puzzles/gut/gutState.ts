/**
 * 굿판(5스테이지) 진행 — 건네지 못한 가락지를 소반에 올려 굿을 열고, 꺼진 횃불 다섯을 일이 일어난 차례대로 다시 켠다.
 *   waiting   틈을 지나 금줄 앞에 섰다. 횃불 다섯이 타오른다. 소반에 넋의 자리가 아직 없다
 *   rite      가락지 한 쌍을 소반에 올렸다 — 징이 울리고 바람이 횃불을 다 끈다. 말뚝마다 그림패가 걸려 있다
 *   released  다섯 불을 차례대로 다 켰다 — 바람이 거세지고 불기둥이 치솟는다. 불길이 횃불대를 타고 내려와 땅을 달려 소반에 붙는다
 *   dawn      소반이 타오르며 가락지 한 쌍이 하늘로 떠오르고, 밤이 걷혀 날이 갠다. 불과 바람이 잦아든다(끝)
 */
import { createChangeSignal } from "@/lib/changeSignal";
import { gameNow } from "@/engine/input/gameClock";

type GutStage = "waiting" | "rite" | "released" | "dawn";

export interface SavedGut {
  stage: GutStage;
  /** 차례대로 켠 횃불 수(0~5) */
  lit: number;
}

const signal = createChangeSignal();
// 게임 시계 — 터치 모드에서 멈춘 동안은 단계 경과가 흐르지 않는다
const now = () => gameNow() / 1000;
const initial = (): SavedGut => ({ stage: "waiting", lit: 0 });

let state = initial();
let stageAt = 0;
/** 틈 너머에서 굿 불이 타오른 정도(0~1) — 바위 위에서 구렁이상을 끼운 뒤 EdgeRift 가 올린다 */
let called = 0;
let glow = 0;
let wind = 0;
let tableChar = 0;

function enter(stage: GutStage, lit = state.lit) {
  state = { stage, lit };
  stageAt = now();
  signal.notify();
}

export const gut = {
  state: () => state,
  stage: () => state.stage,
  subscribe: signal.subscribe,
  /** 지금 단계에 들어선 지 몇 초 */
  elapsed: () => now() - stageAt,
  /** 가락지를 올렸다 — 굿이 열린다 */
  begin: () => enter("rite", 0),
  /** 가락지를 도로 집었다 — 굿이 멎고 횃불이 되살아난다 */
  pause: () => enter("waiting", 0),
  /** 제 차례의 횃불을 켰다 */
  light() {
    state = { ...state, lit: state.lit + 1 };
    signal.notify();
  },
  /** 차례가 어긋났다 — 켠 불이 다 꺼진다 */
  blowOut() {
    state = { ...state, lit: 0 };
    signal.notify();
  },
  release: () => enter("released"),
  dawn: () => enter("dawn"),
  /** 이어 하기 — 지나가던 끝 연출은 끝난 모습(새벽)으로 돌아온다 */
  restore(saved: SavedGut) {
    state = { ...initial(), ...saved };
    if (state.stage === "released") state = { ...state, stage: "dawn" };
    stageAt = now() - 999;
    signal.notify();
  },
  reset: () => enter("waiting", 0),
  setCalledFires(level: number) {
    called = level;
  },
  calledFires: () => called,
  /** 굿판이 밝은 정도(0~1) — 켜진 횃불만큼. 금줄 둘레를 밝히는 빛(EdgeRift)이 따른다 */
  setGlow(level: number) {
    glow = level;
  },
  glow: () => glow,
  /** 굿판에 이는 바람(0~1) — 가락지를 올릴 때의 돌풍 · 불기둥이 솟을 때. 금줄 천자락(RitualCircle)이 따른다 */
  setWind(level: number) {
    wind = level;
  },
  wind: () => wind,
  /** 소반이 탄 정도(0~1) — 타는 동안 소반과 제물(RitualCircle)이 그을리며 오그라들고, 1 이면 사라진다 */
  setTableChar(level: number) {
    tableChar = level;
  },
  tableChar: () => tableChar,
  isTableBurnt: () => tableChar >= 1,
};
