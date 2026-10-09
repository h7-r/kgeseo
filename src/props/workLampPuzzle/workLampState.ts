/**
 * 비밀 복도 끝 「어둠 속의 배선」 퍼즐의 상태 상자.
 * 램프는 하나뿐이라 한 번에 한 구간만 밝힌다 — 표식을 다 모으려면 복도를 실제로 오가야 한다.
 * 들고 다니면 배터리라 약하고 분기함에 꽂으면 전원이라 세다. 분필 자국은 센 빛에서만 읽혀
 * "들고 비춰 보기"가 아니라 "꽂아야" 한다 — 이 차이가 퍼즐을 성립시키는 유일한 규칙이다.
 */
import { useSyncExternalStore } from "react";
import type { Vector3Tuple } from "three";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";
import { lobbyStore } from "@/lobby/interactions";

import { getHeldCoin } from "../coinState";
import { getNozzleLocation } from "../nozzleState";

/** 분기함 세 곳. 순서 = 복도 끝에서 방 쪽으로. */
export const JUNCTION_SLOTS = ["A", "B", "C"] as const;
export type JunctionSlot = (typeof JUNCTION_SLOTS)[number];

/** floor — 복도 끝 잔해 사이(시작) · hand — 들고 다님 · A|B|C — 분기함에 꽂힘 */
export type WorkLampLocation = "floor" | "hand" | JunctionSlot;

const isJunctionSlot = (value: string): value is JunctionSlot => (JUNCTION_SLOTS as readonly string[]).includes(value);

// 그림 퍼즐의 창 여섯 — 사람과 처음 불이 일부러 엇갈려 네 경우가 다 있다.
export const WINDOW_COUNT = 6;
/** 1 = 그 창에 사람이 있다. 그림과 답이 같은 값을 본다. */
export const LAST_TRAIN_PASSENGERS = "101101";
const INITIAL_LIGHTS = "100110";
const createInitialLights = () => [...INITIAL_LIGHTS].map((c) => c === "1");

/**
 * 스위치 안 퍼즐 선 셋은 전부 같은 회색이고 끝의 접속 모양으로 맞춘다.
 * 배전반이 색으로 맞추니 또 색을 쓰면 같은 퍼즐을 두 번 하는 것이다(색맹과도 무관하다).
 */
export type WireShape = "round" | "square" | "triangle";
export const WIRE_SHAPES: readonly WireShape[] = ["round", "square", "triangle"];
/** 화면에 보이는 모양 이름 */
export const WIRE_SHAPE_LABELS: Record<WireShape, string> = {
  round: "둥근",
  square: "네모",
  triangle: "세모",
};
const isWireShape = (value: string): value is WireShape => Object.hasOwn(WIRE_SHAPE_LABELS, value);

export type TrashBin = "general" | "plastic";
export type TrashId =
  "petBottle" | "detergentBottle" | "yogurtBottle" | "takeoutCup" | "toothbrush" | "straw" | "receipt" | "tissue";

interface TrashItem {
  id: TrashId;
  /** 화면에 보이는 이름 */
  name: string;
  bin: TrashBin;
}

/**
 * 쓰레기 여덟. 자리·모양은 그림 쪽이 갖는다.
 * 일반 넷 중 셋은 플라스틱·종이처럼 보이는 것이라 줍고 넣는 게 아니라 판단이 된다
 * (환경부 「내 손안의 분리배출」 기준).
 */
export const TRASH_ITEMS: readonly TrashItem[] = [
  { id: "petBottle", name: "페트병", bin: "plastic" },
  { id: "detergentBottle", name: "세제 통", bin: "plastic" },
  { id: "yogurtBottle", name: "요구르트 병", bin: "plastic" },
  { id: "takeoutCup", name: "테이크아웃 컵", bin: "plastic" },
  { id: "toothbrush", name: "칫솔", bin: "general" }, // 여러 재질이 섞여 재활용이 안 된다
  { id: "straw", name: "빨대", bin: "general" }, // 너무 작아 선별이 안 된다
  { id: "receipt", name: "영수증", bin: "general" }, // 감열지 — 종이로도 안 된다
  { id: "tissue", name: "쓴 휴지", bin: "general" },
];
/** 화면에 보이는 통 이름 */
export const BIN_LABELS: Record<TrashBin, string> = { general: "일반쓰레기", plastic: "플라스틱" };
const isTrashBin = (value: string): value is TrashBin => Object.hasOwn(BIN_LABELS, value);

type TrashPlace = "floor" | TrashBin;

interface WorkLampState {
  location: WorkLampLocation;
  /** 지금까지 드러내 본 분기함(다시 꽂지 않아도 기억한다) */
  seenMarks: JunctionSlot[];
  /**
   * 전기는 두 번에 나눠 들어온다. 한 번에 다 켜면 뒤의 퍼즐이 "왜 해야 하나"를 잃는다.
   * power — 주 차단기를 올려 복도 끝 절반만 · fullPower — 시험반까지 풀어 자판기 쪽까지 전부.
   */
  power: boolean;
  fullPower: boolean;
  /** 램프가 지금 놓인 자리. null 이면 Leva 의 첫 자리 — 아무 데나 둬야 한 손 규칙에서 손을 비운다. */
  floorSpot: Vector3Tuple | null;
  /** 이어지는 퍼즐 끝문(비상계단) 전기 잠금을 풀었나 */
  endDoorReleased: boolean;
  heldWire: WireShape | null;
  /** 꽂는 자리 → 꽂힌 가닥 */
  pluggedWires: Record<WireShape, WireShape | null>;
  /** 모양이 틀려 튕겨 나간 시각(초) */
  wireSparkAt: number;
  /** 손에 든 것은 heldTrash 로 따로 본다 */
  trash: Record<TrashId, TrashPlace>;
  heldTrash: TrashId | null;
  trashRejectedAt: number;
  /** 방금 틀린 쓰레기를 받은 통 */
  rejectingBin: TrashBin | null;
  /** 통마다 몫을 다 채워 전류가 흐르기 시작한 시각(초) */
  flowStartedAt: Record<TrashBin, number>;
  /** 그림 퍼즐 스위치 하나가 창 하나의 불. 사람 있는 창은 켜고 빈 창은 끄면 완전 전원. */
  windowSwitches: boolean[];
}

const createTrashOnFloor = () =>
  Object.fromEntries(TRASH_ITEMS.map((t) => [t.id, "floor"])) as Record<TrashId, TrashPlace>;

const state: WorkLampState = {
  location: "floor",
  seenMarks: [],
  power: false,
  fullPower: false,
  floorSpot: null,
  endDoorReleased: false,
  heldWire: null,
  pluggedWires: { round: null, square: null, triangle: null },
  wireSparkAt: -99,
  trash: createTrashOnFloor(),
  heldTrash: null,
  trashRejectedAt: -99,
  rejectingBin: null,
  flowStartedAt: { general: -99, plastic: -99 },
  windowSwitches: createInitialLights(),
};

const signal = createChangeSignal();

export const getWorkLampLocation = () => state.location;
/**
 * 이 퍼즐 물건(램프·전선 가닥·쓰레기)으로 손이 찼나.
 * 다른 퍼즐의 한 손 규칙은 이걸 본다 — 램프만 보면 쓰레기를 든 채 동전을 또 집는다.
 */
export const isWorkLampPuzzleHandFull = () => state.location === "hand" || !!state.heldWire || !!state.heldTrash;

/**
 * 이미 손이 찼나 — 램프를 집을 수 있는지의 기준.
 * 반대 방향(동전·관창 쪽에서 램프를 보는 것)은 순환 import 가 되므로 App 의 disabled 에서 막는다.
 */
function isHandFull() {
  if (getHeldCoin()) return true;
  if (getNozzleLocation() === "hand") return true;
  if (state.heldWire) return true;
  if (state.heldTrash) return true;
  const lobby = lobbyStore.get();
  return !!lobby.heldItem || !!lobby.draggedChair;
}

/** 바닥이나 분기함에서 집어 든다. */
export function pickUpWorkLamp() {
  if (state.location === "hand") return false;
  if (isHandFull()) return false;
  const unplugging = isJunctionSlot(state.location);
  state.location = "hand";
  playSound(unplugging ? "boxDown" : "boxUp", { volume: 0.85 });
  signal.notify();
  return true;
}

/** 분기함에 꽂는다. 꽂는 순간 그 칸의 표식을 본 것으로 적는다 — 왕복은 한 번이면 충분하다. */
export function plugWorkLamp(slot: string) {
  if (state.location !== "hand") return false;
  if (!isJunctionSlot(slot)) return false;
  state.location = slot;
  if (!state.seenMarks.includes(slot)) state.seenMarks = [...state.seenMarks, slot];
  playSound("boxDown", { volume: 0.95 });
  signal.notify();
  return true;
}

/**
 * 보고 있는 바닥에 내려놓는다. 처음 자리에서만 놓게 하면 동전 하나 주우려고
 * 55 유닛을 되돌아와야 한다 — 그건 퍼즐이 아니라 벌이다.
 * @param spot 안 주면 있던 자리에 그대로 둔다.
 */
export function dropWorkLamp(spot: Vector3Tuple | null = null) {
  if (state.location !== "hand") return false;
  state.location = "floor";
  if (spot) state.floorSpot = [spot[0], spot[1], spot[2]];
  playSound("boxDown", { volume: 0.8 });
  signal.notify();
  return true;
}

/** 램프가 지금 놓인 자리(없으면 null — 부르는 쪽이 첫 자리를 쓴다) */
export const getWorkLampFloorSpot = () => state.floorSpot;

/** 세 칸을 다 읽었나 — 차단기함 자물쇠를 만질 이유가 생기는 시점 */
export const hasSeenAllMarks = () => JUNCTION_SLOTS.every((k) => state.seenMarks.includes(k));

/** 차단기를 올렸나 — 복도등 절반이 들어왔나 */
export const isCorridorPowered = () => state.power;
/** 시험반까지 풀었나 — 복도등이 전부 들어왔나 */
export const hasFullPower = () => state.fullPower;
export function raiseBreaker() {
  if (state.power) return false;
  // 선 셋을 다 꽂아야 올라간다. 안 막으면 함 속 퍼즐이 장식이 된다.
  if (isWiringCorrect()) {
    state.power = true;
    playSound("boxDown", { volume: 1 });
    signal.notify();
    return true;
  }
  return false;
}

export const isEndDoorReleased = () => state.endDoorReleased;
/** 끝문 전기 잠금 해제 — 완전 전원이 들어와야 버튼이 산다. */
export function releaseEndDoor() {
  if (!state.fullPower || state.endDoorReleased) return false;
  state.endDoorReleased = true;
  playSound("button", { volume: 1 });
  signal.notify();
  return true;
}

// 스위치 안 퍼즐 — 선 연결
export const getHeldWireShape = () => state.heldWire;
export const getPluggedWires = () => state.pluggedWires;
/** 이 가닥이 지금 빠져 늘어져 있나 */
export const isWireDangling = (shape: WireShape) =>
  state.heldWire !== shape &&
  state.pluggedWires.round !== shape &&
  state.pluggedWires.square !== shape &&
  state.pluggedWires.triangle !== shape;
/** 셋이 다 제자리에 꽂혔나 — 레버를 올릴 수 있는 조건 */
const isWiringCorrect = () =>
  state.pluggedWires.round === "round" &&
  state.pluggedWires.square === "square" &&
  state.pluggedWires.triangle === "triangle";
export const getPluggedWireCount = () => WIRE_SHAPES.filter((k) => state.pluggedWires[k]).length;

export function pickUpWire(shape: string) {
  if (!isWireShape(shape)) return false;
  if (state.heldWire) return false;
  if (state.location === "hand" || isHandFull()) return false; // 한 손 규칙
  for (const socket of WIRE_SHAPES)
    if (state.pluggedWires[socket] === shape) state.pluggedWires = { ...state.pluggedWires, [socket]: null };
  state.heldWire = shape;
  playSound("boxUp", { volume: 0.7 });
  signal.notify();
  return true;
}

/** 쥔 가닥을 놓는다 — 늘어진 제자리로 돌아간다. */
export function dropWire() {
  if (!state.heldWire) return false;
  state.heldWire = null;
  playSound("boxDown", { volume: 0.6 });
  signal.notify();
  return true;
}

let wireSparkTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 쥔 가닥을 꽂는 자리에 꽂는다. 모양이 안 맞아도 꽂히기는 하고 빠지직 튀며 도로 빠진다 —
 * 막으면 "왜 안 되지"가 되고, 튀면 "끝 모양을 봐야 하는구나"가 그 자리에서 읽힌다.
 */
export function plugWireInto(socket: string) {
  const shape = state.heldWire;
  if (!shape) return false;
  if (!isWireShape(socket)) return false;
  if (state.pluggedWires[socket]) return false;
  state.heldWire = null;
  state.pluggedWires = { ...state.pluggedWires, [socket]: shape };
  signal.notify();
  if (shape === socket) {
    playSound("button", { volume: 0.9 });
    return true;
  }
  playSound("locked", { volume: 0.9 });
  if (wireSparkTimer) clearTimeout(wireSparkTimer);
  wireSparkTimer = setTimeout(() => {
    wireSparkTimer = null;
    if (state.pluggedWires[socket] !== shape) return;
    state.pluggedWires = { ...state.pluggedWires, [socket]: null };
    state.wireSparkAt = performance.now() / 1000;
    playSound("locked", { volume: 1 });
    signal.notify();
  }, 600);
  return true;
}

// 분리수거 퍼즐
// 일반·플라스틱 두 통은 전선으로 맞은편 그림 액자에 이어져 있다. 한 통의 몫을 다 채우면
// 그 선으로 전류가 흐르고, 둘 다 흐르면 그림의 창에 불이 든다.
export const getHeldTrash = () => state.heldTrash;
export const getTrashPlace = (id: TrashId): TrashPlace | "hand" =>
  state.heldTrash === id ? "hand" : (state.trash[id] ?? "floor");
export const getTrashRejectedAt = () => state.trashRejectedAt;
export const getRejectingBin = () => state.rejectingBin;
/** 이 통에 제대로 들어간 수 */
export const getBinCount = (bin: TrashBin) => TRASH_ITEMS.filter((t) => state.trash[t.id] === bin).length;
export const isSortingDone = () => TRASH_ITEMS.every((t) => state.trash[t.id] === t.bin);

/** 바닥의 쓰레기를 줍는다 — 비상 전원이 들어온 뒤에만(어둠 속에선 안 보인다). */
export function pickUpTrash(id: TrashId) {
  if (!state.power || isSortingDone()) return false;
  if (state.trash[id] !== "floor") return false;
  if (state.location === "hand" || isHandFull()) return false; // 한 손 규칙
  state.heldTrash = id;
  playSound("boxUp", { volume: 0.6 });
  signal.notify();
  return true;
}

/** 든 쓰레기를 제자리 바닥에 도로 둔다([F]). */
export function dropTrash() {
  if (!state.heldTrash) return false;
  state.heldTrash = null;
  playSound("boxDown", { volume: 0.6 });
  signal.notify();
  return true;
}

/** 통에 버린다. 틀려도 들어가기는 하고 덜컹 튀어나와 제자리 바닥으로 돌아간다. */
export function throwTrash(bin: string) {
  const id = state.heldTrash;
  if (!id || !isTrashBin(bin)) return false;
  const item = TRASH_ITEMS.find((t) => t.id === id);
  state.heldTrash = null;
  if (item?.bin !== bin) {
    state.trashRejectedAt = performance.now() / 1000;
    state.rejectingBin = bin;
    playSound("locked", { volume: 0.9 });
    signal.notify();
    return false;
  }
  state.trash = { ...state.trash, [id]: bin };
  playSound("boxDown", { volume: 0.9 });
  if (isBinComplete(bin)) {
    state.flowStartedAt[bin] = performance.now() / 1000;
    playSound("button", { volume: 1 });
  }
  signal.notify();
  return true;
}

/** 이 통의 몫을 다 채웠나 — 그 통의 전선에 전류가 흐른다 */
export const isBinComplete = (bin: TrashBin) =>
  TRASH_ITEMS.filter((t) => t.bin === bin).every((t) => state.trash[t.id] === bin);
/** 전류가 흐르기 시작한 시각(초) — 앞머리가 선을 타고 가는 연출에 쓴다 */
export const getFlowStartedAt = (bin: TrashBin) => state.flowStartedAt[bin];
/** 두 통 다 흐른다 — 그림 액자에 전기가 들어왔다 */
export const isPaintingPowered = () => isBinComplete("general") && isBinComplete("plastic");

// 그림 퍼즐 — 객차 조명 시험반
export const isWindowSwitchOn = (index: number) => state.windowSwitches[index];
/** "100110" 처럼 켬 = 1. 그림 속 창의 불도 이 값을 따른다. */
const getWindowSwitchKey = () => state.windowSwitches.map((v) => (v ? "1" : "0")).join("");
/**
 * 시험반 스위치 하나를 젖힌다. 사람 있는 창만 켜진 그 순간 완전 전원이 들어오고 스위치가 잠긴다
 * (다시 끄면 복도가 도로 꺼지는 건 벌이지 퍼즐이 아니다).
 */
export function toggleWindowSwitch(index: number) {
  if (!isPaintingPowered() || state.fullPower) return false;
  const next = [...state.windowSwitches];
  next[index] = !next[index];
  state.windowSwitches = next;
  playSound("button", { volume: 0.55 });
  if (getWindowSwitchKey() === LAST_TRAIN_PASSENGERS) {
    state.fullPower = true;
    playSound("boxDown", { volume: 1 });
  }
  signal.notify();
  return true;
}

/** 처음부터 다시(개발용) */
function resetWorkLamp() {
  state.location = "floor";
  state.seenMarks = [];
  state.power = false;
  state.fullPower = false;
  state.floorSpot = null;
  state.endDoorReleased = false;
  state.heldWire = null;
  state.pluggedWires = { round: null, square: null, triangle: null };
  state.wireSparkAt = -99;
  state.trash = createTrashOnFloor();
  state.heldTrash = null;
  state.trashRejectedAt = -99;
  state.rejectingBin = null;
  state.windowSwitches = createInitialLights();
  state.flowStartedAt = { general: -99, plastic: -99 };
  if (wireSparkTimer) {
    clearTimeout(wireSparkTimer);
    wireSparkTimer = null;
  }
  signal.notify();
}

// 구독 훅 — 전부 원시값을 돌려준다. 객체는 판마다 참조가 달라 전부 다시 그린다.
const subscribe = signal.subscribe;
export const useWorkLampLocation = () => useSyncExternalStore(subscribe, getWorkLampLocation, getWorkLampLocation);
export const useIsCorridorPowered = () => useSyncExternalStore(subscribe, isCorridorPowered, isCorridorPowered);
export const useHasFullPower = () => useSyncExternalStore(subscribe, hasFullPower, hasFullPower);
export const useHeldTrash = () => useSyncExternalStore(subscribe, getHeldTrash, getHeldTrash);
const getTrashKey = () => TRASH_ITEMS.map((t) => getTrashPlace(t.id)).join("|");
/** 쓰레기 자리를 문자열로 — 바뀌면 다시 그린다 */
export const useTrashKey = () => useSyncExternalStore(subscribe, getTrashKey, getTrashKey);
export const useWindowSwitchKey = () => useSyncExternalStore(subscribe, getWindowSwitchKey, getWindowSwitchKey);
export const useIsPaintingPowered = () => useSyncExternalStore(subscribe, isPaintingPowered, isPaintingPowered);
export const useIsEndDoorReleased = () => useSyncExternalStore(subscribe, isEndDoorReleased, isEndDoorReleased);
export const useHeldWireShape = () => useSyncExternalStore(subscribe, getHeldWireShape, getHeldWireShape);
export const useIsWiringCorrect = () => useSyncExternalStore(subscribe, isWiringCorrect, isWiringCorrect);
const getPluggedWiresKey = () =>
  `${state.pluggedWires.round ?? "-"}|${state.pluggedWires.square ?? "-"}|${state.pluggedWires.triangle ?? "-"}`;
/** 꽂힌 상태를 문자열로 구독한다 */
export const usePluggedWiresKey = () => useSyncExternalStore(subscribe, getPluggedWiresKey, getPluggedWiresKey);

// 헤드리스 시험은 포인터 잠금이 없어 걸어 다닐 수 없다. 꽂힌 상태를 밖에서 만든다.
exposeDevHook("workLamp", {
  location: getWorkLampLocation,
  pickUp: pickUpWorkLamp,
  plug: (slot: string) => {
    state.location = "hand";
    return plugWorkLamp(slot);
  },
  raiseBreaker,
  releaseEndDoor,
  drop: dropWorkLamp,
  reset: resetWorkLamp,
  // 손에 쥐는 단계를 건너뛴다
  plugWire: (shape: WireShape, socket: string) => {
    state.heldWire = shape;
    return plugWireInto(socket);
  },
  pickUpWire: (shape: string) => {
    state.heldWire = null;
    return pickUpWire(shape);
  },
  // 줍는 단계를 건너뛰고 바로 버린다
  throwTrash: (id: TrashId, bin: string) => {
    state.heldTrash = id;
    return throwTrash(bin);
  },
  sortingState: () => ({ ...state.trash, held: state.heldTrash, done: isSortingDone() }),
  fullPower: hasFullPower,
  paintingPowered: isPaintingPowered,
  toggleWindow: (index: number) => {
    toggleWindowSwitch(index);
    return getWindowSwitchKey();
  },
  wiringState: () => ({
    heldWire: state.heldWire,
    pluggedWires: { ...state.pluggedWires },
    correct: isWiringCorrect(),
  }),
  // 0 이면 "상자는 바뀌는데 화면이 안 따라온다"의 원인이 구독 끊김(또는 모듈 두 벌)이다.
  listenerCount: signal.listenerCount,
});
