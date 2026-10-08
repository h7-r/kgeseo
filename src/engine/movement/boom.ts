import type * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

import { RUN } from "./constants";

/** 그 프레임에 있을 수 있는 사각 범위(방·복도) */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type BoundsAt = (position: THREE.Vector3) => Bounds;
/** 벽·기둥·가구에 막히나. y 를 보는 판정이면 바닥의 낮은 가구가 눈높이 붐을 막지 않는다. */
export type BlockTest = (x: number, z: number, y?: number) => boolean;

/**
 * 1인칭 걸음 배속. 1인칭은 눈이 곧 속도계라 같은 m/s 도 3인칭보다 빠르게 느껴진다 —
 * 두 시점 모두 0.95 m/s 로 묶는다. 콘솔에서 바로 바꿔 볼 수 있다.
 */
export const firstPersonSpeed = {
  /** 걷기 3.15 유닛/초 ≈ 0.95 m/s */
  scale: 1.05,
  /** 1인칭 달리기 배수 — 8.1 유닛/초 ≈ 2.44 m/s */
  runMultiplier: RUN,
};

/** 3인칭 걸음 배속. 따로 두지 않으면(null) 1인칭 값을 따라간다. */
export const thirdPersonSpeed: { override: number | null; readonly scale: number } = {
  override: null,
  get scale(): number {
    return this.override ?? firstPersonSpeed.scale;
  },
};

exposeDevHook("firstPersonSpeed", firstPersonSpeed);
exposeDevHook("thirdPersonSpeed", thirdPersonSpeed);

/**
 * 3인칭 붐 설정(미터). App 의 Leva 「3인칭 시점」 폴더가 매 프레임 Object.assign 으로 덮어쓴다 —
 * 그래서 그 폴더의 열쇠 이름은 이 객체의 필드 이름과 같아야 한다.
 */
export interface ThirdPersonConfig {
  /** 피벗에서 카메라까지 */
  distance: number;
  /** 눈높이에서 이만큼 위에서 돈다 — 머리 너머로 본다 */
  pivotHeight: number;
  /** 오른쪽으로 민 거리(오버더숄더). 0 이면 뒤통수 시점 */
  shoulderOffset: number;
  /** 붐의 굵기. 근평면 모서리가 벽을 안 뚫게 한다 */
  boomRadius: number;
  /** 클수록 빨리 펴진다(접힐 때는 언제나 즉시) */
  extendSpeed: number;
  /** 바닥을 볼 때 최대 이만큼(비율) 짧아진다 */
  pullWhenLookingDown: number;
  pullWhenLookingUp: number;
  /** 3인칭에서만 넓히는 시야각. 0 이면 안 바꾼다 */
  fov: number;
  fovSpeed: number;
  /** 끄면 단순 붐(피벗 = 눈 · 어깨 0 · 굵기 없는 붐) */
  enabled: boolean;
}

export const thirdPersonConfig: ThirdPersonConfig = {
  distance: 2.0,
  pivotHeight: 0.22,
  shoulderOffset: 0.3,
  boomRadius: 0.16,
  extendSpeed: 3.2,
  pullWhenLookingDown: 0.45,
  pullWhenLookingUp: 0.2,
  fov: 64,
  fovSpeed: 4,
  enabled: true,
};

exposeDevHook("thirdPersonConfig", thirdPersonConfig);

export interface BoomState {
  distance: number;
  group: THREE.Object3D | null;
  visible: boolean;
  collapsedFrames: number;
  pivotPulledFrames: number;
  pivotDroppedFrames: number;
  fixPivot: boolean;
  useLegacyEscape: boolean;
}

/**
 * 붐 길이와 아바타를 씌운 칸. 칸을 여기 두는 이유는 순서다 — 이동 계산이 붐을 구한 그 자리에서
 * 칸을 끄지 않으면, 시점을 바꾸는 순간 아바타가 카메라 코앞에 한 프레임 번쩍인다.
 */
export const boomState: BoomState = {
  /** 99 = 아직 3인칭으로 한 프레임도 안 돌았다 */
  distance: 99,
  group: null,
  visible: true,
  // 진단용 — 트인 자리에서 오르면 무언가 잘못 막고 있는 것이다.
  collapsedFrames: 0,
  pivotPulledFrames: 0,
  pivotDroppedFrames: 0,
  /** false 면 피벗 되돌리기를 끈다(A/B 비교용) */
  fixPivot: true,
  /** true 면 「갇힘 면제」(벽 안에서 시작하면 충돌을 무시하는 동작)로 돈다(A/B 비교용) */
  useLegacyEscape: false,
};

exposeDevHook("boom", boomState);

/** 걸음 진단. enabled 를 켜면 useMovement 가 매 프레임 숫자를 적는다. */
export interface MovementDebug {
  enabled: boolean;
  commandedSpeed?: number;
  speedScale?: number;
  substeps?: number;
  blockedX?: number;
  blockedZ?: number;
  startX?: number;
  startZ?: number;
  dt?: number;
  actualSpeed?: number;
  isThirdPerson?: boolean;
}

export const movementDebug: MovementDebug = { enabled: false };

exposeDevHook("movementDebug", movementDebug);

/**
 * 붐 손잡이 중 Leva 가 덮어쓰지 못하게 코드에 둔 상한. 「3인칭 시점」 값은 저장값이 매 프레임 덮어써서
 * 기본값을 고쳐도 안 먹는다 — 이길 수 있는 곳은 쓰는 자리뿐이다.
 */
export const boomLimits = {
  /** 눈에서 카메라까지 지킬 최소 거리(m). 모자라면 카메라를 띄워 1인칭이 되지 않게 한다. */
  minEyeDistance: 1.4,
  /** 그 최소를 채우려고 올릴 수 있는 최대치(m). 크면 가구·칸막이 너머가 보인다. */
  liftLimit: 0.4,
  /** 피치 당김의 상한(비율). 없으면 달리며 시선을 흔들 때 화면이 확대·축소된다. */
  pullDownLimit: 0.15,
  pullUpLimit: 0.08,
};

exposeDevHook("setLiftLimit", (meters = 0.4) => (boomLimits.liftLimit = meters));
exposeDevHook("setMinEyeDistance", (meters = 1.4) => (boomLimits.minEyeDistance = meters));
exposeDevHook("setPullLimits", (enabled = true) => {
  boomLimits.pullDownLimit = enabled ? 0.15 : 1;
  boomLimits.pullUpLimit = enabled ? 0.08 : 1;
  return { pullDownLimit: boomLimits.pullDownLimit, pullUpLimit: boomLimits.pullUpLimit };
});

// 머리 반지름 0.55 + 카메라 near 0.25 보다 가까우면 머릿속이다. 문턱이 하나면 벽 앞에서 몸이 깜빡인다.
const HIDE_BELOW = 0.9;
const SHOW_ABOVE = 1.4;

/** 눈에서 카메라까지의 거리를 알리고, 그 자리에서 아바타 칸을 켜고 끈다. */
export function reportBoomLength(distance: number) {
  boomState.distance = distance;
  if (boomState.visible && distance < HIDE_BELOW) boomState.visible = false;
  else if (!boomState.visible && distance > SHOW_ABOVE) boomState.visible = true;
  if (boomState.group) boomState.group.visible = boomState.visible;
}

/**
 * 3인칭 카메라가 물러날 수 있는 거리(유닛). 사람이 못 가는 곳은 카메라도 못 간다는 규칙으로
 * 씬의 경계·막힘 판정을 그대로 쓴다. 등을 벽에 붙이면 0 이 나온다.
 * radius 는 붐의 굵기 — 선 하나로 밀면 근평면 모서리가 벽을 뚫어 옆방이 보인다.
 */
export function boomDistance(
  pivot: THREE.Vector3,
  back: THREE.Vector3,
  maxDistance: number,
  boundsAt: BoundsAt | undefined,
  isBlocked: BlockTest | undefined,
  radius = 0,
): number {
  const step = 0.25;
  const bounds = boundsAt ? boundsAt(pivot) : null;

  // 붐 옆면을 같이 짚을 두 점(붐 방향과 수직인 수평 벡터)
  const sideX = -back.z;
  const sideZ = back.x;
  const sideLength = Math.hypot(sideX, sideZ) || 1;
  const ox = (sideX / sideLength) * radius;
  const oz = (sideZ / sideLength) * radius;

  // 경계도 반경만큼 안쪽으로 줄인다. 벽 면에 딱 붙는 것까지 허용하면 굵기를 준 의미가 없다.
  const inner = bounds
    ? {
        minX: bounds.minX + radius,
        maxX: bounds.maxX - radius,
        minZ: bounds.minZ + radius,
        maxZ: bounds.maxZ - radius,
      }
    : null;

  const blockedAt = (x: number, z: number, y: number) => {
    if (inner && (x < inner.minX || x > inner.maxX || z < inner.minZ || z > inner.maxZ)) return true;
    if (!isBlocked) return false;
    // 가운데 + 좌우 옆면 세 점이면 굵은 붐을 충분히 흉내 낸다.
    return isBlocked(x, z, y) || isBlocked(x + ox, z + oz, y) || isBlocked(x - ox, z - oz, y);
  };

  // 시작점을 안쪽 사각 안으로 끌어다 놓는다. 「갇힘 면제」 는 벽에 조금만 다가가도 켜져 충돌을 통째로 무시해
  // 카메라를 방 밖으로 내보낸다.
  let startX = pivot.x;
  let startZ = pivot.z;
  if (inner && !boomState.useLegacyEscape) {
    startX = Math.min(Math.max(startX, inner.minX), inner.maxX);
    startZ = Math.min(Math.max(startZ, inner.minZ), inner.maxZ);
  }

  let reachable = 0;
  let isStillTrapped = boomState.useLegacyEscape ? blockedAt(startX, startZ, pivot.y) : false;
  for (let d = step; d <= maxDistance; d += step) {
    const blocked = blockedAt(startX + back.x * d, startZ + back.z * d, pivot.y + back.y * d);
    if (isStillTrapped) {
      reachable = d;
      if (!blocked) isStillTrapped = false;
      continue;
    }
    if (blocked) break;
    reachable = d;
  }
  if (isStillTrapped) reachable = Math.min(reachable, maxDistance * 0.35);
  if (reachable === 0) boomState.collapsedFrames += 1;
  return Math.min(reachable, maxDistance);
}
