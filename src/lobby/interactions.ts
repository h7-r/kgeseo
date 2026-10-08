/**
 * 로비(S4)에서 물건을 겨냥하고 [E] 로 다루는 층.
 * 본편 조사(investigation)는 계약 v0.3.1 의 objects[] 를 따르고 여닫기·들기·밀기 같은
 * 물리 조작이 없다. 로비는 계약 밖 FE 전용 공간이라 어휘가 달라 층을 나눠 둔다.
 * 가드레일: 물건은 사라지지 않고(GRD-01), 길을 막는 조작은 넣지 않으며(GRD-12),
 * 창이 열려 있으면 E 를 처리하지 않는다(GRD-11, App 에서 차단).
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { playSound, startLoop, stopLoop } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface InteractableInfo {
  label?: string | (() => string);
  position: () => Vector3Tuple | null | undefined;
  run: () => void;
  /** 물건 크기. 겨냥 점수의 잣대이기도 하다. */
  radius?: number;
  /** 손 닿는 거리. 안 주면 INTERACT_REACH. */
  reach?: number;
  disabled?: boolean | (() => boolean);
}

// ── 겨냥 ──
// 겨냥은 고개만 돌려도 바뀐다. 물건 상태와 같은 상자에 두면 둘러보기만 해도
// 로비 전체가 다시 그려지므로 따로 둔다.

const targets = new Map<string, InteractableInfo>();

let aimedId: string | null = null;
const aimSignal = createChangeSignal();

export const aim = {
  get: () => aimedId,
  subscribe: aimSignal.subscribe,
};

/** 지금 겨냥 중인 것을 실행한다. 처리했으면 true (E 키가 여기서 소비된다). */
export function runAimed() {
  const target = aimedId && targets.get(aimedId);
  if (!target) return false;
  target.run();
  return true;
}

// 광선 대신 "시선에서 옆으로 얼마나 벗어났나"만 잰다. 병합 메시·외곽선 껍데기에
// 광선을 쏘면 주인을 거슬러 찾아야 하고 비싸다. 물건이 전부 한 점으로 대표되는 소품이라 충분하다.
const INTERACT_REACH = 6; // ≈1.8m
const DEFAULT_RADIUS = 0.9;
// 허용 범위만 넓힌다. 반경 자체를 키우면 점수(÷반경)가 같이 부풀어 작은 물건이 옆 큰 물건을 가로챈다.
const AIM_SLACK = 1.15;
// 빈손으로 집을 때만 거리를 더 준다. 들고 있을 때 넓히면 내려놓으려던 E 가 옆 스탠드를 켠다.
const REACH_SLACK = 1.2;

const forward = new THREE.Vector3();
const offset = new THREE.Vector3();

// 이미 한 번 알린 대상은 다시 찍지 않는다(매 프레임 콘솔이 넘친다).
const brokenTargets = new Set<string>();

/**
 * 겨냥 대상을 다시 고른다. 겨냥판정 컴포넌트가 정한 주기마다 부른다.
 * @param origin 거리를 재는 기준점. 3인칭에서는 카메라가 캐릭터 뒤 9유닛이라 캐릭터 자리를 넘긴다.
 *   보는 방향은 어느 쪽이든 카메라 것이다.
 */
export function updateAim(camera: THREE.Camera, enabled = true, origin: Point3 | null = null) {
  if (!enabled) {
    if (aimedId !== null) {
      aimedId = null;
      aimSignal.notify();
    }
    return;
  }
  camera.getWorldDirection(forward);
  // 닿나는 사람 자리에서, 보나는 카메라 광선에서 잰다. 한 점에서 둘 다 재면
  // 3인칭에서 발밑 물건이 시선 평면 뒤로 넘어가 잡히지 않는다.
  const eye = camera.position;
  const hand = origin ?? camera.position;

  let foundId: string | null = null;
  let bestScore = Infinity;
  const holding = !!state.heldItem;

  for (const [id, target] of targets) {
    // 한 대상이 터지면 겨냥 루프 전체(문·집기·호버)가 멈춘다. 건너뛰기만 한다.
    let point: Vector3Tuple | null | undefined;
    try {
      const disabled = typeof target.disabled === "function" ? target.disabled() : target.disabled;
      if (disabled) continue;
      point = target.position();
    } catch (error) {
      if (!brokenTargets.has(id)) {
        brokenTargets.add(id);
        console.error(`[겨냥] "${id}" 가 말썽이라 건너뜁니다.`, error);
      }
      continue;
    }
    if (!point) continue;

    const limit = (target.reach ?? INTERACT_REACH) + (holding ? 0 : REACH_SLACK);
    offset.set(point[0] - hand.x, point[1] - hand.y, point[2] - hand.z);
    if (offset.lengthSq() > limit * limit) continue;

    offset.set(point[0] - eye.x, point[1] - eye.y, point[2] - eye.z);
    const along = offset.dot(forward);
    if (along <= 0) continue;
    const sideSq = offset.lengthSq() - along * along;
    const radius = target.radius ?? DEFAULT_RADIUS;
    const allowed = radius + (holding ? 0 : AIM_SLACK);
    if (sideSq > allowed * allowed) continue;

    // 제 크기에 견준 벗어남으로 고른다. 큰 물건 안을 겨눴으면 옆 소품의 점보다 이긴다.
    const score = sideSq / (radius * radius);
    if (score < bestScore) {
      bestScore = score;
      foundId = id;
    }
  }

  if (foundId !== aimedId) {
    aimedId = foundId;
    aimSignal.notify();
  }
}

/** 지금 겨냥한 것의 자리. 손붙이기가 팔을 그쪽으로 뻗는다. */
export function aimedPosition(): Vector3Tuple | null {
  if (!aimedId) return null;
  const target = targets.get(aimedId);
  if (!target) return null;
  try {
    return target.position() ?? null;
  } catch {
    return null; // 위치 함수가 터져도 팔 때문에 게임이 멈추면 안 된다
  }
}

/**
 * 겨냥 대상으로 등록한다. 컴포넌트가 살아 있는 동안만.
 * position·run 은 매 렌더 새 함수라 의존성에 넣으면 등록이 계속 풀린다 — 최신 값을 ref 로 읽는다.
 */
export function useInteractable(id: string, info: InteractableInfo) {
  const latest = useRef(info);
  useLayoutEffect(() => {
    latest.current = info;
  });
  useEffect(() => {
    targets.set(id, {
      get label() {
        return latest.current.label;
      },
      get radius() {
        return latest.current.radius;
      },
      get reach() {
        return latest.current.reach;
      },
      get disabled() {
        return latest.current.disabled;
      },
      position: () => latest.current.position(),
      run: () => latest.current.run(),
    });
    return () => {
      targets.delete(id);
      if (aimedId === id) {
        aimedId = null;
        aimSignal.notify();
      }
    };
  }, [id]);
}

// ── 물건 상태 ── 실제로 뭔가 바뀔 때만 알린다

export interface DrawerOpening {
  row: number;
  /** 뺀 깊이. 0 이면 닫힘이라 null 로 둔다. */
  amount: number;
}

interface ChairSpot {
  x: number;
  z: number;
}

export interface ItemSpot {
  x: number;
  y: number;
  z: number;
  rot: number;
}

export interface LobbyState {
  drawers: Record<string, DrawerOpening | null>;
  /** 없으면 Leva 기본값을 따른다. */
  lamps: Record<string, boolean>;
  draggedChair: string | null;
  /** 없으면 Leva 원래 자리. */
  chairSpots: Record<string, ChairSpot>;
  heldItem: string | null;
  /** 물건 → 지금 놓인 자리. 없으면 Leva 원래 자리. */
  itemSpots: Record<string, ItemSpot>;
}

let state: LobbyState = {
  drawers: {},
  lamps: {},
  draggedChair: null,
  chairSpots: {},
  heldItem: null,
  itemSpots: {},
};

const lobbySignal = createChangeSignal();
function patch(partial: Partial<LobbyState>) {
  state = { ...state, ...partial };
  lobbySignal.notify();
}

export const lobbyStore = {
  get: () => state,
  subscribe: lobbySignal.subscribe,
};

export const useLobbyState = () => useSyncExternalStore(lobbyStore.subscribe, lobbyStore.get);

// ── 서랍 ──
// 서랍 몸통은 뺀 깊이에 따라 지오메트리가 다시 만들어진다. 매 프레임 바꾸면 비싸서
// 몇 단계로 끊는다 — 눈에는 그래도 스르륵으로 읽힌다.
const OPEN_STEPS = [0.25, 0.55, 0.8, 1];
const CLOSE_STEPS = [0.8, 0.55, 0.25, 0]; // 마지막 0 = 완전히 닫힘
const DRAWER_STEP_MS = 45;

type DrawerDirection = "open" | "close";

/**
 * 서랍을 연다/닫는다. 지금 열려 있는지는 씬이 정한다 — 캐비닛은 손대기 전에도
 * Leva 연출값으로 몇 칸이 열려 있어 이 상자만 보면 모른다.
 */
export function moveDrawer(cabinetId: string, row: number, maxAmount: number, direction: DrawerDirection) {
  playSound(direction === "open" ? "drawerOpen" : "drawerClose", { volume: 0.9 });
  playDrawerSteps(cabinetId, row, maxAmount, direction);
}

const drawerTimers = new Map<string, ReturnType<typeof setInterval>>();
function playDrawerSteps(cabinetId: string, row: number, maxAmount: number, direction: DrawerDirection) {
  clearInterval(drawerTimers.get(cabinetId));
  let index = 0;
  const steps = direction === "open" ? OPEN_STEPS : CLOSE_STEPS;
  const step = () => {
    const ratio = steps[index];
    // null 이면 서랍 컴포넌트를 떼어 GLB 앞판이 그대로 보인다(손대기 전 모습).
    const next = ratio <= 0 ? null : { row, amount: maxAmount * ratio };
    patch({ drawers: { ...state.drawers, [cabinetId]: next } });
    if (++index >= steps.length) {
      clearInterval(drawerTimers.get(cabinetId));
      drawerTimers.delete(cabinetId);
    }
  };
  step();
  if (steps.length > 1) drawerTimers.set(cabinetId, setInterval(step, DRAWER_STEP_MS));
}

// ── 램프 ──
export const isLampOn = (id: string, fallback: boolean) => state.lamps[id] ?? fallback;
export function toggleLamp(id: string, fallback: boolean) {
  patch({ lamps: { ...state.lamps, [id]: !isLampOn(id, fallback) } });
}

// ── 의자 끌기 ──
// 문 앞에 둔 의자도 다시 E 로 옮길 수 있어 갇히지 않는다(GRD-12). 놓을 자리를 제한하면
// "왜 여기 못 놓는지"를 글자 없이 설명할 길이 없다.
export const draggedChair = () => state.draggedChair;

export function grabChair(id: string) {
  if (state.draggedChair || state.heldItem) return false;
  patch({ draggedChair: id });
  startLoop("chair", { volume: 0.9 });
  return true;
}

export function dropChair(x: number, z: number) {
  const id = state.draggedChair;
  if (!id) return false;
  stopLoop("chair");
  // 잡은 첫 프레임에 놓으면 좌표가 비어 있을 수 있다. 그대로 쓰면 의자가 원점으로 날아간다.
  const valid = Number.isFinite(x) && Number.isFinite(z);
  patch({
    draggedChair: null,
    chairSpots: valid ? { ...state.chairSpots, [id]: { x, z } } : state.chairSpots,
  });
  return true;
}

// ── 들기 / 놓기 ──
// 놓을 좌표는 placement 가 계산한다. 여기서는 결과 좌표만 물건별로 들고 있는다.

type ItemSoundId = "paper" | "cupDown" | "boxUp" | "boxDown";
const itemSound = (id: string, pickingUp: boolean): ItemSoundId =>
  id.startsWith("paper") ? "paper" : id.startsWith("mug") ? "cupDown" : pickingUp ? "boxUp" : "boxDown";

export function pickUp(itemId: string) {
  if (state.heldItem || state.draggedChair) return;
  patch({ heldItem: itemId });
  playSound(itemSound(itemId, true), { volume: 0.9 });
}

/** 든 것을 겹침 검사를 통과한 자리에 놓는다. */
export function placeHeld(spot: ItemSpot | null | undefined) {
  const held = state.heldItem;
  if (!held || !spot) return false;
  patch({ heldItem: null, itemSpots: { ...state.itemSpots, [held]: { ...spot } } });
  playSound(itemSound(held, false), { volume: 0.9 });
  return true;
}

/** 든 것을 원래 자리로 돌려놓는다. */
export function returnHeld() {
  const held = state.heldItem;
  if (!held) return;
  const itemSpots = { ...state.itemSpots };
  delete itemSpots[held];
  playSound(itemSound(held, false), { volume: 0.9 });
  patch({ heldItem: null, itemSpots });
}

// 헤드리스 브라우저에는 포인터 잠금이 없어 겨냥이 돌지 않는다. updateAim 을 직접 돌려 시험한다.
exposeDevHook("lobby", { lobbyStore, aim, runAimed, updateAim, aimedPosition, returnHeld });
// 등록된 상호작용 지점 전부와 그 자리. 하나씩 걸어가 확인하지 않으려고 둔다.
exposeDevHook("targets", () =>
  [...targets].map(([id, target]) => {
    let position: Vector3Tuple | null | undefined | "오류";
    let disabled: boolean | undefined | "오류";
    try {
      position = target.position();
    } catch {
      position = "오류";
    }
    try {
      disabled = typeof target.disabled === "function" ? target.disabled() : target.disabled;
    } catch {
      disabled = "오류";
    }
    return {
      id,
      position,
      label: target.label,
      disabled,
      reach: target.reach,
      radius: target.radius,
    };
  }),
);
