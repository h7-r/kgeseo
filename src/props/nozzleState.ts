/**
 * 소화전 관창(호스 노즐)이 지금 어디 있나.
 * 집고 꽂는 사건에만 바뀌므로 리액트 밖 store 로 둔다 — 집었다고 복도 전체가 다시 그려지지 않는다.
 * 한 손 규칙: 동전·머그를 들고 있으면 못 집는다(둘이 카메라 앞 같은 자리에 겹친다).
 * 반대 방향은 coinState 가 이 파일을 부르면 순환 import 가 되므로 App 의 disabled 에서 막는다.
 */
import { useSyncExternalStore } from "react";
import type * as THREE from "three";
import type { Vector3Tuple } from "three";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";
import { lobbyStore } from "@/lobby/interactions";

import { heldCoin } from "./coinState";

/** cabinet — 소화전함 안 제자리 · hand — 들고 있음 · plugged — 배전반 구멍에 꽂힘 */
export type NozzleLocation = "cabinet" | "hand" | "plugged";

const state: { location: NozzleLocation } = { location: "cabinet" };

const signal = createChangeSignal();

export const nozzleLocation = () => state.location;

/** 이미 뭔가 들고(끌고) 있나 — 관창을 집을 수 있는지의 기준. */
export function handsBusy() {
  if (heldCoin()) return true;
  const lobby = lobbyStore.get();
  return !!lobby.heldItem || !!lobby.draggedChair;
}

/** 함 속이나 꽂힌 자리에서 집어 든다. */
export function pickUpNozzle() {
  if (state.location === "hand") return false;
  if (handsBusy()) return false;
  state.location = "hand";
  playSound("boxUp", { volume: 0.9 });
  signal.notify();
  return true;
}

/** 배전반 구멍에 꽂는다. */
export function plugNozzle() {
  if (state.location !== "hand") return false;
  state.location = "plugged";
  playSound("boxDown", { volume: 0.9 });
  signal.notify();
  return true;
}

// 호스가 매달릴 두 끝
// 함 쪽 끝과 관창 커플링을 서로 다른 컴포넌트가 그리므로 여기서 만나게 한다.
// 부모가 움직이면 좌표는 곧 낡으므로 Object3D 를 받는다.
interface HoseAnchors {
  /**
   * 관창이 함에 걸려 있던 고정 기준점. 끌려 나온 길이·한계를 이 점으로 잰다 —
   * 다발 끝으로 재면 그 점이 움직여 호스가 매 프레임 출렁인다.
   */
  anchor: Vector3Tuple | null;
  cabinetEnd: THREE.Object3D | null;
  nozzleEnd: THREE.Object3D | null;
  /** 구역 최적화가 복도를 끄면 함 쪽 그룹이 사라진다. 마지막 월드 좌표를 그대로 쓴다. */
  cabinetEndPosition: Vector3Tuple | null;
  forward: Vector3Tuple;
  /** 소화전함이 재서 넣어 준다. 이만큼만 끌고 갈 수 있다. */
  totalLength: number;
  maxDistance: number;
  /** 지금 그려진 줄의 길이(보기용 — 판단에는 안 쓴다) */
  drawnLength: number;
  /** 기준점에서 관창까지 — 다발을 얼마나 풀지 정한다 */
  nozzleDistance: number;
  /** 기준점에서 눈까지 — 멀어지는 걸음만 막으려고 본다 */
  playerDistance: number;
}

const anchors: HoseAnchors = {
  anchor: null,
  cabinetEnd: null,
  nozzleEnd: null,
  cabinetEndPosition: null,
  forward: [1, 0, 0],
  totalLength: 0,
  maxDistance: 0,
  drawnLength: 0,
  nozzleDistance: 0,
  playerDistance: 0,
};

/** 함 쪽 호스 끝을 알려 준다. 돌려받은 함수를 부르면 등록이 풀린다. */
export function registerCabinetEnd(object: THREE.Object3D | null, forward: Vector3Tuple = [1, 0, 0]) {
  anchors.cabinetEnd = object;
  anchors.forward = forward;
  return () => {
    if (anchors.cabinetEnd === object) anchors.cabinetEnd = null;
  };
}
/** 움직이지 않는 기준점(관창 제자리) — 길이·한계 계산의 근거. */
export function registerAnchor(x: number, y: number, z: number) {
  anchors.anchor = [x, y, z];
}
/** 지금 화면에 있는 관창의 커플링(호스가 물리는 자리). */
export function registerNozzleEnd(object: THREE.Object3D | null) {
  anchors.nozzleEnd = object;
  return () => {
    if (anchors.nozzleEnd === object) anchors.nozzleEnd = null;
  };
}
export const hoseAnchors = anchors;

/**
 * 호스가 다 풀렸으면 더 못 간다(늘어나지 않는다).
 * 멀어지는 걸음만 막는다 — 이미 한계 밖이면 통째로 막을 때 그 자리에 갇힌다.
 */
export function isHoseTaut(x: number, z: number) {
  if (state.location !== "hand") return false;
  const a = anchors.anchor ?? anchors.cabinetEndPosition;
  if (!a || !(anchors.maxDistance > 0)) return false;
  const d = Math.hypot(x - a[0], z - a[2]);
  if (d <= anchors.maxDistance) return false;
  return d >= (anchors.playerDistance || d) - 1e-6;
}

/** 개발·시험용 — 소화전함 제자리로 되돌린다 */
export function resetNozzle() {
  state.location = "cabinet";
  signal.notify();
}

export const useNozzle = () => {
  useSyncExternalStore(signal.subscribe, signal.version);
  return state.location;
};

exposeDevHook("nozzle", {
  state,
  nozzleLocation,
  pickUpNozzle,
  plugNozzle,
  resetNozzle,
  handsBusy,
  hoseAnchors: anchors,
  isHoseTaut,
});
