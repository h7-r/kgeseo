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

import { vendingFocus } from "./electricPanel/circuitPaths";
import { isHingeOpen } from "./hingeState";
import { getNozzleLocation, setNozzleReleaseSource } from "./nozzleState";

/** 0 = 빨강 · 1 = 파랑 · 2 = 노랑 */
export type WireColor = 0 | 1 | 2;

export const WIRE_COLOR_NAMES = ["빨강", "파랑", "노랑"] as const;

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
export const getHeldWire = () => state.held;
/** 위 선 t 에 꽂힌 아래 선의 색. */
export const getPluggedWire = (top: WireColor) => state.plugged[top] ?? null;
/** 아래 선 c 가 꽂힌 위 선 번호. 안 꽂혔으면 −1. */
export const getWireSocket = (color: WireColor) => state.plugged.indexOf(color);
const isWiringSolved = () => state.plugged.every((c, t) => c === t);

// 뽑아서 풀림이 깨지면 시각도 0 으로 — 다시 풀 때 불빛이 처음부터 켜져야 푼 티가 난다.
function updateSolvedState() {
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
  if (getWireSocket(color) >= 0) return false;
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
  updateSolvedState();
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
  updateSolvedState();
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
  return !!id && isHingeOpen(id);
}

export const areAllCircuitsLive = () => isCircuitLive(0) && isCircuitLive(1) && isCircuitLive(2);
// 회로가 다 살아야 소화전함의 관창을 꺼낼 수 있다 — 그때 관창과 배전반 구멍이 같이 빛난다(nozzleState · NozzleSocket)
setNozzleReleaseSource(areAllCircuitsLive);

// 전류가 가는 길 — 배전반 → 호스 → 소화전, 핸들을 돌리면 소화전 → 전선관 → 음료 자판기.
/** 호스로 소화전까지 · 전선관으로 자판기까지 걸리는 시간(초) */
export const HOSE_FLOW_SECONDS = 3;
export const CONDUIT_FLOW_SECONDS = 3.2;
/** 자판기에 전류가 닿은 뒤 불빛이 날뛰다가 밀리기 시작할 때까지(초) */
export const VENDING_FRENZY_SECONDS = 2;

const HOSE_SETTLE_SECONDS = 0.25;
let hoseFlowStartedAt = -1;
let connectedSince: number | null = null;
let valveTurnedAt = -1;
export const getHoseFlowStartedAt = () => hoseFlowStartedAt;
export const getValveTurnedAt = () => valveTurnedAt;

/** 회로가 다 살고 관창까지 꽂히면 전류가 호스를 타기 시작한다 — 프레임마다 본다. 관창을 뽑으면 끊긴다 */
export function updateHoseFlow(now: number) {
  if (valveOpening) return;
  const isConnected = areAllCircuitsLive() && getNozzleLocation() === "plugged";
  connectedSince = isConnected ? (connectedSince ?? now) : null;
  // 꽂힌 호스가 자리를 잡은 뒤에 출발한다 — 전류가 그 호스 모양을 그대로 탄다
  const shouldFlow = connectedSince !== null && now - connectedSince >= HOSE_SETTLE_SECONDS;
  if (shouldFlow === hoseFlowStartedAt >= 0 || (isConnected && !shouldFlow)) return;
  hoseFlowStartedAt = shouldFlow ? now : -1;
  signal.notify();
}

/** 전류가 소화전까지 다 왔나 */
const isHoseCharged = (now = performance.now() / 1000) =>
  hoseFlowStartedAt >= 0 && now >= hoseFlowStartedAt + HOSE_FLOW_SECONDS;

// 소화전 개폐 밸브 — 호스로 온 전류가 소화전에 닿아야 돌아간다.
let valveOpening: 0 | 1 = 0;
export const getValveOpening = () => valveOpening;
export const canTurnValve = () => !valveOpening && isHoseCharged();
export function turnValve() {
  if (!canTurnValve()) return false;
  valveOpening = 1;
  valveTurnedAt = performance.now() / 1000;
  playSound("lockOpen", { volume: 0.9 });
  signal.notify();
  return true;
}

/** 전선관 전류가 자판기에 닿는 시각(초). 핸들을 안 돌렸으면 Infinity */
const getVendingStruckAt = () => (valveTurnedAt >= 0 ? valveTurnedAt + CONDUIT_FLOW_SECONDS : Infinity);
/** 문이 다 열리는 시각(초) */
export const getVendingDoorOpenedAt = () => getVendingStruckAt() + VENDING_FRENZY_SECONDS + vendingFocus.pushSeconds;
/** 자판기 불빛이 날뛰고 있나 — 전류가 닿은 때부터 문이 다 열릴 때까지. 그 뒤 문을 여닫아도 다시 날뛰지 않는다 */
export const isVendingFrenzy = (now: number) => now >= getVendingStruckAt() && now < getVendingDoorOpenedAt();
/** 불빛이 한참 날뛴 뒤 자판기가 밀리기 시작한다 */
export const canVendingMove = (now = performance.now() / 1000) => now >= getVendingStruckAt() + VENDING_FRENZY_SECONDS;

/** 개발·테스트용 초기화 */
function resetWiring() {
  state.held = null;
  state.plugged = [null, null, null];
  state.solvedAt = 0;
  valveOpening = 0;
  hoseFlowStartedAt = -1;
  connectedSince = null;
  valveTurnedAt = -1;
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
  switchIds: () => switchIds,
});
