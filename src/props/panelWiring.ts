/**
 * 배전반 속 퍼즐 3색 선의 지금 상태와 규칙.
 * 아래 선(차단기 쪽)을 잡아 위 선(접속함 쪽)에 꽂는다. 색 번호는 위·아래가 같아
 * "위 t 에 아래 c 가 꽂혔고 t === c" 면 그 한 줄이 맞은 것이다.
 * 색이 틀려도 꽂힌다 — 틀린 자리를 알아채고 도로 뽑는 것까지가 퍼즐이다.
 * 뽑은 가닥은 다시 쥔 상태가 되어 바로 옆에 꽂아 볼 수 있다.
 */
import { useSyncExternalStore } from "react";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import { isOpen } from "./hingeState";
import { nozzleLocation } from "./nozzleState";

/** 0 = 빨강 · 1 = 파랑 · 2 = 노랑 */
export type WireColor = 0 | 1 | 2;

export const COLOR_NAMES = ["빨강", "파랑", "노랑"] as const;

interface WiringState {
  held: WireColor | null;
  /** plugged[t] = 위 선 t 에 꽂힌 아래 선의 색 */
  plugged: [WireColor | null, WireColor | null, WireColor | null];
  /** 셋 다 제 색에 꽂힌 시각(ms). 0 이면 아직 — 접속함 불빛이 이 시각부터 켜진다. */
  solvedAt: number;
}

const state: WiringState = {
  held: null,
  plugged: [null, null, null],
  solvedAt: 0,
};

const signal = createChangeSignal();

/** 지금 쥐고 있는 아래 선의 색. */
export const heldWire = () => state.held;
/** 위 선 t 에 꽂힌 아래 선의 색. */
export const pluggedWire = (top: WireColor) => state.plugged[top] ?? null;
/** 아래 선 c 가 꽂힌 위 선 번호. 안 꽂혔으면 −1. */
export const wireSocket = (color: WireColor) => state.plugged.indexOf(color);
const isWiringSolved = () => state.plugged.every((c, t) => c === t);

// 뽑아서 풀림이 깨지면 시각도 0 으로 — 다시 풀 때 불빛이 처음부터 켜져야 푼 티가 난다.
function remeasureSolved() {
  const solved = isWiringSolved();
  if (solved && !state.solvedAt) state.solvedAt = performance.now();
  else if (!solved && state.solvedAt) state.solvedAt = 0;
}

/** 아래 선을 쥔다. 쥐고 있던 그 선이면 놓는다. */
export function grabWire(color: WireColor) {
  if (state.held === color) {
    state.held = null;
    playSound("button", { volume: 0.9 });
    signal.notify();
    return true;
  }
  if (state.held !== null) return false; // 한 번에 한 가닥만
  if (wireSocket(color) >= 0) return false;
  state.held = color;
  playSound("button", { volume: 0.9 });
  signal.notify();
  return true;
}

/** 쥐고 있는 선을 위 선 t 에 꽂는다. */
export function plugWire(top: WireColor) {
  if (state.held === null) return false;
  if (state.plugged[top] !== null) return false;
  state.plugged[top] = state.held;
  state.held = null;
  playSound("button", { volume: 0.9 });
  remeasureSolved();
  signal.notify();
  return true;
}

/** 위 선 t 에 꽂힌 것을 뽑아 쥔다. 다른 걸 쥐고 있으면 못 뽑는다. */
export function unplugWire(top: WireColor) {
  const color = state.plugged[top];
  if (color === null) return false;
  if (state.held !== null) return false;
  state.plugged[top] = null;
  state.held = color;
  playSound("button", { volume: 0.9 });
  remeasureSolved();
  signal.notify();
  return true;
}

// 차단기까지 본 회로
// 선은 여기가, 차단기 위치는 hingeState 가, 어느 차단기가 어느 색인지는 배전반 그림만 안다.
// 배전반이 열릴 때 짝을 적어 두면 함을 닫아(컴포넌트가 사라져)도 밸브가 다시 잠기지 않는다.
let switchIds: (string | null)[] = [null, null, null];

/** 배전반이 제 차단기 id 셋을 알려 준다(색 순서). */
export function registerSwitchIds(ids: (string | null)[]) {
  switchIds = ids;
}

/** 선이 제 짝에 꽂히고 그 차단기가 올라갔나. */
export function isCircuitLive(color: WireColor) {
  if (state.plugged[color] !== color) return false;
  const id = switchIds[color];
  return !!id && isOpen(id);
}

export const areAllCircuitsLive = () => isCircuitLive(0) && isCircuitLive(1) && isCircuitLive(2);

// 소화전 개폐 밸브 — 회로가 다 살고 관창까지 꽂혀야 돌아간다.
let valve: 0 | 1 = 0;
export const valveOpen = () => valve;
export const canTurnValve = () => !valve && areAllCircuitsLive() && nozzleLocation() === "plugged";
export function turnValve() {
  if (!canTurnValve()) return false;
  valve = 1;
  playSound("lockOpen", { volume: 0.9 });
  signal.notify();
  return true;
}

/** 개발·테스트용 초기화 */
function resetWiring() {
  state.held = null;
  state.plugged = [null, null, null];
  state.solvedAt = 0;
  valve = 0;
  signal.notify();
}

export const usePanelWiring = () => useSyncExternalStore(signal.subscribe, signal.version);

exposeDevHook("panelWiring", {
  state,
  grabWire,
  plugWire,
  unplugWire,
  turnValve,
  resetWiring,
});
