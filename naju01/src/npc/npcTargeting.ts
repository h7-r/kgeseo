// NPC 대화 접근 판정 · 대화 자동 종료 판정 — 순수 함수(React 의존 없음). 훅(useNajuNpcFollow)이 매 프레임 부른다.
//
// [좌표] 거리·시선은 NPC 좌표(미터 · 플레이어 발 기준)로, 화면 투영은 게임이 그린 NPC 자리(유닛)와 실제 카메라로 잰다.
// [시선] 렌더 메시로 광선을 쏘지 않는다(나주 씬은 무리 수천 개라 매 프레임 광선은 비싸다). NPC 충돌 세계(소품 원기둥 ·
//   도면 차단물)로 플레이어 → NPC 선분이 막히는지 본다. 그래서 「그림에는 가리는데 충돌 모형에는 없는 것」(나뭇잎 ·
//   NPC 몸보다 낮아 걸러낸 소품 · 지형 언덕)은 못 막고, 「충돌 원기둥이 그림보다 굵은 것」은 더 막는다.
//   그 차이는 checks 의 J 묶음이 실제 씬으로 잰다.
import * as THREE from "three";

import type { NpcBehavior } from "./behaviorState";
import { isSegmentClear, type CollisionWorld } from "./collision";

export const INTERACTION_CONFIG = {
  /** 대화를 걸 수 있는 플레이어–NPC 수평 거리 (m) */
  talkDistance: 2.5,
  /** 대화 중 이보다 멀어지면 대화를 끝낸다 (m) */
  leaveDistance: 4,
  /** 시선 선분의 반경 (m) — 얇게 둔다 */
  sightRadius: 0.05,
};

export type InteractionConfig = typeof INTERACTION_CONFIG;

/** 대화를 못 거는 이유 (먼저 걸린 것 하나) */
export type InteractionBlock =
  | "interacting" // 이미 대화 중
  | "inactive" // 씬이 멈춤(부감 · 검수 고정 · 포인터 잠금 전)
  | "unlocked" // 포인터 잠금이 아님 (편집 모드는 대개 잠금을 풀고 쓴다)
  | "cut" // 구역 진입 컷 연출 중
  | "blocked" // 밖에서 막음 (편집 · 부감 등 — 지금 통합 패치는 넘기지 않는다)
  | "no-npc" // NPC·플레이어 자리를 아직 모름
  | "too-far"
  | "off-screen"
  | "occluded"; // 충돌 세계 기준 시선이 막힘

export interface InteractionInput {
  behavior: NpcBehavior;
  sceneActive: boolean;
  pointerLocked: boolean;
  cutActive: boolean;
  /** 밖에서 막을 때 true (편집 · 부감 등) */
  blocked: boolean;
  /** NPC 추적 자리 (m) — y 는 몸 가운데 높이 */
  npc: { x: number; y: number; z: number } | null;
  /** 플레이어 발 자리 (m) */
  player: { x: number; z: number } | null;
  /** 게임이 그린 NPC 자리 (유닛) */
  npcDrawn: THREE.Vector3;
  camera: THREE.Camera;
  /** NPC 충돌 세계 — 거리·화면 검사를 지난 뒤에만 부른다. null 이면 시선을 못 재므로 막힌 것으로 본다 */
  getCollision: () => CollisionWorld | null;
  config?: InteractionConfig;
}

export interface InteractionResult {
  ok: boolean;
  reason: InteractionBlock | null;
  /** 수평 거리 (m). 자리를 모르면 NaN */
  distance: number;
}

const projected = new THREE.Vector3();
const from = new THREE.Vector3();
const to = new THREE.Vector3();

/** NPC 가 카메라 화면 안(앞쪽 · 시야 사각형 안)에 있는지 */
export function isOnScreen(camera: THREE.Camera, point: THREE.Vector3): boolean {
  projected.copy(point).project(camera);
  return projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
}

export function evaluateInteraction(input: InteractionInput, out?: InteractionResult): InteractionResult {
  const result = out ?? { ok: false, reason: null, distance: NaN };
  const config = input.config ?? INTERACTION_CONFIG;
  const block = (reason: InteractionBlock, distance = NaN) => {
    result.ok = false;
    result.reason = reason;
    result.distance = distance;
    return result;
  };
  if (input.behavior === "Interact") return block("interacting");
  if (!input.sceneActive) return block("inactive");
  if (!input.pointerLocked) return block("unlocked");
  if (input.cutActive) return block("cut");
  if (input.blocked) return block("blocked");
  const { npc, player } = input;
  if (!npc || !player) return block("no-npc");
  const distance = Math.hypot(npc.x - player.x, npc.z - player.z);
  if (distance > config.talkDistance) return block("too-far", distance);
  if (!isOnScreen(input.camera, input.npcDrawn)) return block("off-screen", distance);
  const collision = input.getCollision();
  if (!collision) return block("occluded", distance);
  from.set(player.x, npc.y, player.z);
  to.set(npc.x, npc.y, npc.z);
  if (!isSegmentClear(collision, from, to, npc.y, config.sightRadius)) return block("occluded", distance);
  result.ok = true;
  result.reason = null;
  result.distance = distance;
  return result;
}

/** 대화를 저절로 끝내는 이유 */
export type DialogAutoClose = "inactive" | "unlocked" | "cut" | "distance";

export interface DialogAutoCloseInput {
  sceneActive: boolean;
  pointerLocked: boolean;
  cutActive: boolean;
  /** 수평 거리 (m). 모르면 NaN — 거리로는 끝내지 않는다 */
  distance: number;
  config?: InteractionConfig;
}

/** 대화 중 매 프레임: 끝내야 하면 그 이유, 아니면 null */
export function dialogAutoCloseReason(input: DialogAutoCloseInput): DialogAutoClose | null {
  const config = input.config ?? INTERACTION_CONFIG;
  if (!input.sceneActive) return "inactive";
  if (!input.pointerLocked) return "unlocked";
  if (input.cutActive) return "cut";
  if (input.distance > config.leaveDistance) return "distance";
  return null;
}
