/**
 * 바위 위 4스테이지 진행 — 아랑사가 떨어진 자리를 찾고, 거기 남은 것을 줍는다.
 *   idle     엎어진 사발 셋에 독의 물을 떠, 크기에 맞는 받침(너럭바위 · 받침돌 둘)에 올린다
 *   vision   세 물에 달이 내려앉아 달빛이 선바위에 모이고, 그 뒤의 밤들이 비친다(moonPlay)
 *   flowing  그림이 깨지며 사발 셋에 금이 가 물이 흘러내린다 — 흙에 묻힌 귀때동이 쪽으로
 *   loose    귀때동이가 빠진다. 독의 물을 퍼 담아 발자국이 끊긴 자리에 뿌리면 한 토막씩 드러난다(세 번)
 *   traced   발자국이 벼랑 끝 바위 틈까지 이어졌다 — 미끄러진 자국 · 숨어 있던 셋의 발자국 · 달아난 발자국
 *   found    달아난 발자국 끝 바위틈에서 아랑사의 주머니를 주웠다(편지를 읽는 중)
 *   done     편지를 다 읽었다 — 조가비 가락지 한 쌍. 편지의 숨긴 말이 함에서 나온 구렁이상의 뜻을 일러 준다
 *   opened   구렁이상을 아랑사가 떨어진 자리에 세웠다 — 구렁이가 오르내린 길(틈)이 열리고, 그 너머 물가에 굿 불이 켜진다
 *   crossed  틈을 지나 바위 아래 물가, 금줄 앞에 내려섰다(5스테이지의 시작)
 */
import { createChangeSignal } from "@/lib/changeSignal";
import { gameNow } from "@/engine/input/gameClock";

type CliffStage = "idle" | "vision" | "flowing" | "loose" | "traced" | "found" | "done" | "opened" | "crossed";
const ORDER: CliffStage[] = ["idle", "vision", "flowing", "loose", "traced", "found", "done", "opened", "crossed"];

export interface SavedCliff {
  stage: CliffStage;
  /** 사발마다(큰 · 가운데 · 작은) — 엎어진 자리에서 주웠나 · 물을 담아 제 받침에 올렸나 */
  taken: boolean[];
  placed: boolean[];
  /** 귀때동이를 뽑았나 · 남은 물(뿌릴 수 있는 번) */
  jugTaken: boolean;
  pours: number;
  /** 물을 뿌려 드러낸 발자국 토막 수(0~3) */
  revealed: number;
}

const signal = createChangeSignal();
// 게임 시계 — 터치 모드에서 멈춘 동안은 단계 경과가 흐르지 않는다
const now = () => gameNow() / 1000;

const initial = (): SavedCliff => ({
  stage: "idle",
  taken: [false, false, false],
  placed: [false, false, false],
  jugTaken: false,
  pours: 0,
  revealed: 0,
});

let state = initial();
let stageAt = 0;

export const cliff = {
  state: () => state,
  stage: () => state.stage,
  subscribe: signal.subscribe,
  /** 지금 단계에 들어선 지 몇 초 */
  elapsed: () => now() - stageAt,
  isAtLeast: (at: CliffStage) => ORDER.indexOf(state.stage) >= ORDER.indexOf(at),
  /** 앞으로만 간다 */
  advance(next: CliffStage) {
    if (ORDER.indexOf(next) <= ORDER.indexOf(state.stage)) return;
    state = { ...state, stage: next };
    stageAt = now();
    signal.notify();
  },
  update(patch: Partial<Omit<SavedCliff, "stage">>) {
    state = { ...state, ...patch };
    signal.notify();
  },
  /** 이어 하기 — 지나가던 연출(영상 · 물 흐름)은 끝난 모습으로 돌아온다 */
  restore(saved: SavedCliff) {
    state = { ...initial(), ...saved };
    if (state.stage === "vision" || state.stage === "flowing") state = { ...state, stage: "loose" };
    stageAt = now() - 999;
    signal.notify();
  },
  reset() {
    state = initial();
    stageAt = now();
    signal.notify();
  },
};
