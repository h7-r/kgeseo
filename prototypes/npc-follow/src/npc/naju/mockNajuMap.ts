// 테스트용 가짜 나주 맵. 실제 나주 맵의 도면 수치(sitePlan.ts)를 일부 본뜨고,
// 시험에 필요한 지형(높은 턱·완만한 경사·치울 수 있는 차단물·원형 소품)을 더했다.
// 실제 나주 코드와 같은 모양(najuTypes)으로 값을 내놓으므로 어댑터를 그대로 시험할 수 있다.
//
//   Z1  x 8–28,  z 30–44  고도 0   (나루터) — 나무·울타리 원형 소품, 치울 수 있는 바위 B9
//   T1  x 28–34, z 36.5–40 고도 0  (바위틈 통로)
//   Z2  x 34–56, z 30–44  고도 0   (자갈밭) — 바위 소품, 높은 턱(0.8 m), 완만한 경사
//   Z3  x 34–58, z 8–26   고도 14  (절벽 위)
//   절벽면 x 34–56, z 26–30 (isFall) · 강 z ≥ 44.5 (isWater) · 그 밖은 고도 0 산허리
//   B1  x 28–34, z 30–34.6 (높이 3.5) · B3 x 56–62, z 30–33
import { UNITS_PER_METER } from '../units.ts'
import type {
  AvatarLinkLike,
  NajuBlocker,
  NajuCoreBounds,
  NajuGroundSample,
  NajuPropCollider,
  NajuPropCollidersLike,
  NajuTerrainLike,
} from './najuTypes.ts'

export const MOCK_CORE_BOUNDS: NajuCoreBounds = { minX: 0.5, maxX: 79.5, minZ: 0.5, maxZ: 49.5 }

// T1 바위틈 통로 중심선 — 실제 나주 맵에서는 PATHS 의 중심선 점을 어댑터가 넘긴다
export const MOCK_WAYPOINTS = [
  { id: 'T1-0', x: 27, z: 38.25 },
  { id: 'T1-1', x: 31, z: 38.25 },
  { id: 'T1-2', x: 35, z: 38.25 },
] as const

/** 1차 통합 범위처럼 평탄한 Z1 · T1 · Z2 만 다니게 할 때의 허용 구역 */
export function isFlatTestArea(_x: number, _z: number, sample: NajuGroundSample): boolean {
  return sample.zone === 'Z1' || sample.zone === 'Z2' || sample.path === 'T1'
}

export const MOCK_LEDGE = { x: [44, 48], z: [34, 38], height: 0.8 } as const // 오를 수 없는 턱
export const MOCK_RAMP = { x: [50, 56], z: [38, 44], rise: 0.5 } as const // 걸어 오를 수 있는 경사
export const MOCK_RIVER_Z = 44.5
export const MOCK_CLIFF = { x: [34, 56], z: [26, 30], top: 14 } as const

const inRange = (v: number, r: readonly [number, number]) => v >= r[0] && v <= r[1]

const BLOCKERS: NajuBlocker[] = [
  { code: 'B1', x: [28, 34], z: [30, 34.6], foot: 0, floor: 0, height: 3.5 },
  { code: 'B3', x: [56, 62], z: [30, 33], foot: 0, floor: 0, height: 3.5 },
  // 시험용 — 씬이 끝나면 치우는 차단물 (실제 B2 처럼 clearedBlockers 로 연다)
  { code: 'B9', x: [18, 20], z: [33, 38], foot: 0, floor: 0, height: 3.0 },
]

const PROPS: NajuPropCollider[] = [
  { x: 14, z: 36, radius: 0.4, bottom: 0, top: 5, groupId: '씬1.나무' },
  { x: 14, z: 40, radius: 0.5, bottom: 0, top: 6, groupId: '씬1.나무' },
  { x: 24, z: 41, radius: 0.45, bottom: 0, top: 5, groupId: '씬1.나무' },
  // 울타리 가로대처럼 늘어놓은 작은 원들
  { x: 11, z: 33, radius: 0.25, bottom: 0, top: 1.1, groupId: '씬1.울타리' },
  { x: 11.6, z: 33, radius: 0.25, bottom: 0, top: 1.1, groupId: '씬1.울타리' },
  { x: 12.2, z: 33, radius: 0.25, bottom: 0, top: 1.1, groupId: '씬1.울타리' },
  { x: 12.8, z: 33, radius: 0.25, bottom: 0, top: 1.1, groupId: '씬1.울타리' },
  { x: 40, z: 36, radius: 0.9, bottom: 0, top: 2.0, groupId: '씬2.바위' },
  { x: 52, z: 33, radius: 0.6, bottom: 0, top: 1.5, groupId: '씬2.바위' },
  // 발목 높이 소품 — NPC(지면 + 0.95 ~ 1.65 m)를 막지 않아야 한다
  { x: 30, z: 42, radius: 0.3, bottom: 0, top: 0.4, groupId: '씬1.돌' },
]

function groundAt(px: number, pz: number): NajuGroundSample {
  if (inRange(px, MOCK_CLIFF.x) && pz > MOCK_CLIFF.z[0] && pz < MOCK_CLIFF.z[1]) {
    const f = (pz - MOCK_CLIFF.z[0]) / (MOCK_CLIFF.z[1] - MOCK_CLIFF.z[0])
    return { y: MOCK_CLIFF.top * (1 - f), zone: null, path: null, isFall: true, isWater: false }
  }
  if (pz >= MOCK_RIVER_Z) {
    return { y: -Math.min(2.6, (pz - MOCK_RIVER_Z) * 0.55), zone: null, path: null, isFall: false, isWater: true }
  }
  if (inRange(px, [34, 58]) && inRange(pz, [8, 26])) {
    return { y: MOCK_CLIFF.top, zone: 'Z3', path: null, isFall: false, isWater: false }
  }
  if (inRange(px, MOCK_LEDGE.x) && inRange(pz, MOCK_LEDGE.z)) {
    return { y: MOCK_LEDGE.height, zone: 'Z2', path: null, isFall: false, isWater: false }
  }
  if (inRange(px, MOCK_RAMP.x) && inRange(pz, MOCK_RAMP.z)) {
    const f = (pz - MOCK_RAMP.z[0]) / (MOCK_RAMP.z[1] - MOCK_RAMP.z[0])
    return { y: MOCK_RAMP.rise * f, zone: 'Z2', path: null, isFall: false, isWater: false }
  }
  if (inRange(px, [8, 28]) && inRange(pz, [30, 44])) {
    return { y: 0, zone: 'Z1', path: null, isFall: false, isWater: false }
  }
  if (inRange(px, [28, 34]) && inRange(pz, [36.5, 40])) {
    return { y: 0, zone: null, path: 'T1', isFall: false, isWater: false }
  }
  if (inRange(px, [34, 56]) && inRange(pz, [30, 44])) {
    return { y: 0, zone: 'Z2', path: null, isFall: false, isWater: false }
  }
  return { y: 0, zone: null, path: null, isFall: false, isWater: false }
}

export interface MockNajuMap {
  terrain: NajuTerrainLike & { clearedBlockers: Set<string> }
  props: NajuPropCollidersLike
}

export function createMockNajuMap(): MockNajuMap {
  const clearedBlockers = new Set<string>()
  const terrain = {
    groundAt,
    blockedAt(px: number, pz: number, y = 0, radius = 0.3) {
      for (const b of BLOCKERS) {
        if (clearedBlockers.has(b.code)) continue
        if (y < b.foot - 1.5 || y > b.floor + b.height) continue
        if (px > b.x[0] - radius && px < b.x[1] + radius && pz > b.z[0] - radius && pz < b.z[1] + radius) {
          return b.code
        }
      }
      return null
    },
    blockers: BLOCKERS,
    clearedBlockers,
  }
  const props: NajuPropCollidersLike = {
    colliders: PROPS,
    blockedAt(px: number, pz: number, y = 0, radius = 0.3) {
      for (const c of PROPS) {
        if (y > c.top - 0.25 || y < c.bottom - 1.0) continue
        if (Math.hypot(px - c.x, pz - c.z) < c.radius + radius) return c.groupId
      }
      return null
    },
  }
  return { terrain, props }
}

/** 나주 기본 눈높이(1.6 m)로 선 플레이어 상자를 만든다. 위치는 미터로 받아 유닛으로 저장한다 */
export const MOCK_EYE_HEIGHT = 1.6

export interface MutableAvatarLink extends AvatarLinkLike {
  position: { x: number; y: number; z: number }
  groundY: number
  footY: number
  facing: number
  moving: boolean
  speed: number
  grounded: boolean
}

export function createMockAvatarLink(x: number, z: number, facing = Math.PI): MutableAvatarLink {
  const link: MutableAvatarLink = {
    position: { x: 0, y: 0, z: 0 },
    groundY: 0,
    footY: 0,
    facing,
    moving: false,
    speed: 0,
    grounded: true,
  }
  placeMockPlayer(link, x, z)
  return link
}

/** 나주 이동 코드처럼 지면 위에 플레이어를 세운다 (미터 입력 → 유닛 저장) */
export function placeMockPlayer(link: MutableAvatarLink, x: number, z: number, speedMps = 0): void {
  const ground = groundAt(x, z).y
  link.position.x = x * UNITS_PER_METER
  link.position.z = z * UNITS_PER_METER
  link.position.y = (ground + MOCK_EYE_HEIGHT) * UNITS_PER_METER
  link.groundY = ground * UNITS_PER_METER
  link.footY = link.position.y - MOCK_EYE_HEIGHT * UNITS_PER_METER
  link.speed = speedMps * UNITS_PER_METER
  link.moving = speedMps > 0
}
