/**
 * 전류 따라가기 — 퍼즐이 풀려 전류가 흐를 때 화면이 그 앞머리를 따라간다. FlowFocusCamera 가 그린다.
 * 평소엔 자리는 그대로 두고 시선만 돌리고, finalPosition 을 주면 끝자리에서 화면이 그곳으로 옮겨 간다.
 * 끝나면 돌아가지 않고 그 화면에서 조작을 돌려준다(returnHome 이면 처음 보던 쪽으로 돌아온 뒤). 한 번에 하나만 돈다.
 * 길(path) 없이 끝자리만 주면 그쪽으로 고개만 돌린다 — 「맞은편 배전반도 열렸다」 같은 알림(튜토피드백 10회차).
 */
import type * as THREE from "three";

export interface FlowFocusRequest {
  /** 전류가 가는 길. 없으면 처음부터 끝자리(finalTarget)를 본다 */
  path?: THREE.Curve<THREE.Vector3>;
  /** 전류 출발 시각(초 · performance.now 기준) · 끝까지 걸리는 시간 */
  startedAt: number;
  seconds: number;
  /** 길이 끝난 뒤 바라볼 곳 */
  finalTarget: () => THREE.Vector3Tuple;
  /** 있으면 길이 끝난 뒤 화면 자체가 이 자리로 옮겨 가 정면에서 보고, 몸도 그 자리에서 조작을 넘겨받는다 */
  finalPosition?: () => THREE.Vector3Tuple;
  /** 이 시각(초)까지 끝자리를 본다 */
  holdUntil: () => number;
  /**
   * 끝자리를 적어도 이만큼(초) 본다 — 카메라를 늦게 넘겨받아 시작이 밀려도 끝자리 보기가 줄지 않게.
   * 길이 끝난 때와 화면이 실제로 시작한 때 중 늦은 쪽부터 잰다.
   */
  minHoldSeconds?: number;
  /** 끝자리를 보는 동안 시야각 배율(1 보다 작으면 당긴다). 끝나면 이동 훅이 원래 값으로 천천히 푼다 */
  fovScale?: number;
  /** 다 보고 나면 처음 보던 쪽으로 돌아온 뒤 조작을 넘긴다 */
  returnHome?: boolean;
  /** 화면 떨림 세기(0~1) */
  shake?: () => number;
  /** 화면이 실제로 돌기 시작한 순간 · 조작을 넘긴 순간 */
  onStart?: () => void;
  onFinish?: () => void;
  /** 이 시각(초)까지 카메라를 못 넘겨받으면 버린다(다른 연출이 오래 쥐고 있을 때 한참 뒤에 튀어나오지 않게) */
  expiresAt?: number;
}

let pending: FlowFocusRequest | null = null;

export function requestFlowFocus(request: FlowFocusRequest) {
  pending = request;
}

/** 기다리는 요청 — 카메라를 넘겨받은 뒤에만 takeFlowFocusRequest 로 꺼낸다(못 넘겨받았다고 버리지 않는다) */
export function peekFlowFocusRequest(now: number) {
  if (pending?.expiresAt !== undefined && now > pending.expiresAt) pending = null;
  return pending;
}

export function takeFlowFocusRequest() {
  const request = pending;
  pending = null;
  return request;
}
