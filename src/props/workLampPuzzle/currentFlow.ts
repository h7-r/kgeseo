import * as THREE from "three";

import { getBinFlowStartedAt, isPaintingPowered, type TrashBin } from "./workLampState";

/** 통에서 액자까지 전류가 가는 시간(초) */
export const FLOW_SECONDS = 3.2;
/** 전류가 그림에 닿은 뒤 창에 불이 들기까지(초) */
export const LIGHT_DELAY_SECONDS = 0.75;

/** 두 통의 전류가 다 그림에 닿는 시각(초). 아직 두 통이 안 찼으면 Infinity */
export function getPaintingStruckAt() {
  if (!isPaintingPowered()) return Infinity;
  return Math.max(getBinFlowStartedAt("general"), getBinFlowStartedAt("plastic")) + FLOW_SECONDS;
}

/** 그림에 전류가 닿는 순간의 세기(0~1) — 확 올라 잠시 버티다 가라앉는다 */
export function computeSurge(now: number) {
  const since = now - getPaintingStruckAt();
  if (since < 0) return 0;
  return Math.min(1, since / 0.2) * (1 - THREE.MathUtils.smoothstep(since, 1.5, 3));
}

/** 전선 길 — 전선이 알려 주면 화면 포커싱이 같은 길을 따라간다 */
const flowPaths = new Map<TrashBin, THREE.Curve<THREE.Vector3>>();
export const setFlowPath = (bin: TrashBin, path: THREE.Curve<THREE.Vector3>) => flowPaths.set(bin, path);
export const getFlowPath = (bin: TrashBin) => flowPaths.get(bin) ?? null;
