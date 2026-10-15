// 나주 맵이 NPC 에 넘겨줄 값의 '모양'만 옮겨 적은 타입.
// 원본: origin/dev (4dae76b) 의
//   - src/engine/avatarLink.ts · src/engine/movement/useMovement.ts (PlayerMotionState)
//   - naju01/src/terrain/terrain.ts (createTerrain 의 groundAt · blockedAt · blockers · clearedBlockers)
//   - naju01/src/movement/propColliders.ts (buildPropColliders 결과)
// 프로토타입은 나주 코드를 import 하지 않으므로, 연동 계약으로 쓰는 최소한의 필드만 둔다.
// Stage 1 에서 실제 타입으로 바꿔 끼울 때 필드 이름·단위가 같아야 한다.

/** 플레이어 상자(AvatarLink)에서 NPC 가 읽는 부분. 모두 유닛 단위, 읽기 전용으로만 쓴다. */
export interface AvatarLinkLike {
  readonly position: { readonly x: number; readonly y: number; readonly z: number } // y = 눈높이
  readonly groundY: number // 발밑 지면 (유닛)
  readonly footY: number // 발바닥 (유닛) = position.y − 눈높이
  readonly facing: number // 마지막 이동 방향 (rad), 정면 = (sin, cos)
  readonly moving: boolean
  readonly speed: number // 유닛/s
  readonly grounded: boolean
}

/** terrain.groundAt 결과 (미터) */
export interface NajuGroundSample {
  y: number
  zone: string | null
  path: string | null
  isShoulder?: boolean
  isFall: boolean // 벼랑면 — 서지 못한다
  isWater: boolean
}

/** 도면 차단물 (미터). 높이는 foot ~ floor + height */
export interface NajuBlocker {
  code: string
  x: readonly [number, number]
  z: readonly [number, number]
  foot: number
  floor: number
  height: number
}

/** createTerrain() 결과 중 NPC 가 쓰는 부분 */
export interface NajuTerrainLike {
  groundAt(px: number, pz: number): NajuGroundSample
  blockedAt(px: number, pz: number, y?: number, radius?: number): string | null
  readonly blockers: readonly NajuBlocker[]
  readonly clearedBlockers: ReadonlySet<string>
}

/** buildPropColliders() 결과 (미터) */
export interface NajuPropCollider {
  x: number
  z: number
  radius: number
  bottom: number
  top: number
  groupId: string
}

export interface NajuPropCollidersLike {
  blockedAt(px: number, pz: number, y?: number, radius?: number): string | null
  readonly colliders: readonly NajuPropCollider[]
}

/** terrain.ts 의 CORE_BOUNDS (미터) */
export interface NajuCoreBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
