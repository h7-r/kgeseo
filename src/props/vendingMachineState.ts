/**
 * 자판기 한 대의 지금 상태와 버튼 연출 계산.
 * 버튼 불빛·눌림은 매 프레임 바뀌어 화면이 useFrame 에서 직접 읽는다.
 * 드물게 바뀌는 것(뽑힌 캔·컵·문)만 구독으로 알린다.
 */
import { useSyncExternalStore } from "react";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { showToast } from "@/game/toast";
import { createChangeSignal } from "@/lib/changeSignal";

export type VendingId = "drink" | "coffee";
export type CoffeeTemperature = "hot" | "iced";

export interface VendingMachineState {
  /** 동전을 넣었나(넣으면 버튼이 전부 켜진다) */
  hasCoin: boolean;
  /** 마지막으로 누른 버튼 번호. 없으면 -1 */
  pressed: number;
  pressedAt: number;
  /** 돈이 있는 상태에서 눌렀나(깜빡임은 이때만) */
  pressPaid: boolean;
  /** 커피 배출부 투명문 */
  doorOpen: boolean;
  /** 음료 배출구 덮개 */
  flapOpen: boolean;
  /** 배출구에 나온 음료 번호. 없으면 -1 */
  dispensed: number;
  /** 캔이 떨어져 튕겨 눕는 연출의 시작 시각(ms) */
  canDroppedAt: number;
  hasCup: boolean;
  /** 종이컵이 내려오는 연출의 시작 시각(ms) */
  cupDroppedAt: number;
  temperature: CoffeeTemperature | null;
  /** 파란 캔과 함께 나온 밸브 힌트 종이가 아직 배출구에 있나 */
  hintPaperWaiting: boolean;
}

const createMachineState = (): VendingMachineState => ({
  hasCoin: false,
  pressed: -1,
  pressedAt: 0,
  pressPaid: false,
  doorOpen: false,
  flapOpen: false,
  dispensed: -1,
  canDroppedAt: 0,
  hasCup: false,
  cupDroppedAt: 0,
  temperature: null,
  hintPaperWaiting: false,
});

const machines = new Map<VendingId, VendingMachineState>();
const signal = createChangeSignal();

const getMachineState = (id: VendingId) => {
  let state = machines.get(id);
  if (!state) {
    state = createMachineState();
    machines.set(id, state);
  }
  return state;
};

/**
 * 자판기 전원 — 복도 완전 전원(분리수거 → 창문 스위치, workLampState fullPower)이 들어와야 동전을 받고 음료를 낸다
 * (미르 플레이 시험 11/8 「건너뛰고 자판기로 가서 동전을 넣더라도 음료가 나오지 않고 완료되지 않은 미션이 있다는 것을 암시」,
 * 튜토피드백 검토 01회차). 전원을 아는 쪽(workLampState)이 이 모듈을 가져오므로 거꾸로 가져오지 않고 확인 함수를 꽂아 받는다.
 * 꽂기 전(다른 화면에서 자판기만 쓸 때)은 켜진 것으로 본다.
 */
let powerSource: () => boolean = () => true;
export function setVendingPowerSource(source: () => boolean) {
  powerSource = source;
}
export const isVendingPowered = () => powerSource();
export const VENDING_UNPOWERED_MESSAGE = "자판기에 전원이 들어오지 않는다. 복도에 아직 끝내지 않은 일이 있는 것 같다.";
/** 전원 없는 자판기를 만졌을 때(동전 · 버튼) 까닭을 알린다 */
export const noticeVendingUnpowered = () => showToast(VENDING_UNPOWERED_MESSAGE);

export const vendingMachineStore = {
  get: getMachineState,
  version: signal.version,
  subscribe: signal.subscribe,
};

/** 동전 투입 — 그 자판기 버튼이 전부 켜진다. */
export function insertCoin(id: VendingId) {
  const state = getMachineState(id);
  state.hasCoin = true;
  state.pressed = -1;
  state.pressPaid = false;
  signal.notify();
}

/** 버튼을 누른다. 돈이 없으면 눌리기만 하고 아무 일도 없다(실물과 같다). */
export function pressButton(
  id: VendingId,
  index: number,
  { kind = "drink", temperature = null }: { kind?: VendingId; temperature?: CoffeeTemperature | null } = {},
) {
  const state = getMachineState(id);
  state.pressed = index;
  state.pressedAt = performance.now();
  state.pressPaid = state.hasCoin;
  playSound("button", { volume: 0.9 });
  // 전원이 없으면 눌리기만 한다 — 왜 아무 일도 없는지 알린다
  if (!isVendingPowered()) {
    state.pressPaid = false;
    noticeVendingUnpowered();
    signal.notify();
    return;
  }
  if (state.hasCoin) {
    state.hasCoin = false;
    if (kind === "drink") {
      state.dispensed = index;
      state.canDroppedAt = performance.now();
      // 배출 연출에 맞춰 살짝 늦게 쿵.
      setTimeout(() => playSound("canDrop", { volume: 0.9 }), 90);
    } else {
      state.hasCup = true;
      state.cupDroppedAt = performance.now();
      state.temperature = temperature;
      playSound("cupDrop", { volume: 0.9 });
    }
  }
  signal.notify();
}

export function toggleDoor(id: VendingId) {
  const state = getMachineState(id);
  state.doorOpen = !state.doorOpen;
  signal.notify();
}

export function toggleFlap(id: VendingId) {
  const state = getMachineState(id);
  state.flapOpen = !state.flapOpen;
  // 덮개를 열면 나온 음료를 집어 간 것으로 본다 — 닫을 때 사라진다.
  if (!state.flapOpen) state.dispensed = -1;
  signal.notify();
}

/** 커피 컵을 치운다(문을 닫을 때). */
export function clearCup(id: VendingId) {
  const state = getMachineState(id);
  if (!state.hasCup) return;
  state.hasCup = false;
  state.temperature = null;
  signal.notify();
}

/** 밸브 힌트 종이가 배출구에서 기다리나(파란 캔 = 참, 집어 가면 거짓). */
export function setHintPaperWaiting(id: VendingId, waiting: boolean) {
  const state = getMachineState(id);
  if (state.hintPaperWaiting === waiting) return;
  state.hintPaperWaiting = waiting;
  signal.notify();
}

/** 배출구의 캔을 치운다(집어 갈 때). */
export function clearCan(id: VendingId) {
  const state = getMachineState(id);
  if (state.dispensed < 0) return;
  state.dispensed = -1;
  state.canDroppedAt = 0;
  signal.notify();
}

// 0.16초 동안 들어갔다 나온다. 사인 반주기라 끝이 부드럽다.
const PRESS_SECONDS = 0.16;
export function computePressDepth(id: VendingId, index: number, now: number) {
  const state = getMachineState(id);
  if (state.pressed !== index) return 0;
  const t = (now - state.pressedAt) / 1000;
  if (t < 0 || t > PRESS_SECONDS) return 0;
  return Math.sin((t / PRESS_SECONDS) * Math.PI);
}

// 돈을 넣으면 전부 켜지고, 하나를 누르면 그것만 깜빡이다 꺼진다.
// 돈이 없어도 누른 버튼은 빛난다 — 아무 빛도 없으면 "안 눌렸나?" 싶다.
const BLINK_SECONDS = 1.1;
const BLINK_PERIOD = 0.16;
export function computeButtonLight(id: VendingId, index: number, now: number) {
  const state = getMachineState(id);
  if (state.pressed >= 0) {
    if (index !== state.pressed) return 0;
    const t = (now - state.pressedAt) / 1000;
    if (t > BLINK_SECONDS) return 0;
    // 사각파 — 사인보다 깜빡임이 또렷하다
    return Math.floor(t / (BLINK_PERIOD / 2)) % 2 === 0 ? 1 : 0;
  }
  return state.hasCoin ? 1 : 0;
}

/** 드물게 바뀌는 값만 구독한다. 같은 객체를 제자리에서 고치므로 판 번호로 다시 그린다. */
export const useVendingMachine = (id: VendingId) => {
  useSyncExternalStore(signal.subscribe, signal.version);
  return getMachineState(id);
};

exposeDevHook("vendingMachine", {
  vendingMachineStore,
  insertCoin,
  pressButton,
  toggleDoor,
  toggleFlap,
});
