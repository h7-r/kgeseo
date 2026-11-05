/**
 * 전류 따라가기 — 퍼즐이 풀려 전류가 흐를 때 화면이 그 앞머리를 따라간다. FlowFocusCamera 가 그린다.
 * 평소엔 자리는 그대로 두고 시선만 돌리고, finalPosition 을 주면 끝자리에서 화면이 그곳으로 옮겨 간다.
 * 끝나면 돌아가지 않고 그 화면에서 조작을 돌려준다. 한 번에 하나만 돈다.
 */
import type * as THREE from "three";

export interface FlowFocusRequest {
  /** 전류가 가는 길 */
  path: THREE.Curve<THREE.Vector3>;
  /** 전류 출발 시각(초 · performance.now 기준) · 끝까지 걸리는 시간 */
  startedAt: number;
  seconds: number;
  /** 길이 끝난 뒤 바라볼 곳 */
  finalTarget: () => THREE.Vector3Tuple;
  /** 있으면 길이 끝난 뒤 화면 자체가 이 자리로 옮겨 가 정면에서 보고, 몸도 그 자리에서 조작을 넘겨받는다 */
  finalPosition?: () => THREE.Vector3Tuple;
  /** 이 시각(초)까지 끝자리를 본다 */
  holdUntil: () => number;
  /** 화면 떨림 세기(0~1) */
  shake?: () => number;
}

let pending: FlowFocusRequest | null = null;

export function requestFlowFocus(request: FlowFocusRequest) {
  pending = request;
}

export function takeFlowFocusRequest() {
  const request = pending;
  pending = null;
  return request;
}
