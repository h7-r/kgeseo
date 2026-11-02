// 나주 맵 ↔ NPC 로직 연결. 단위 변환·지형 판정·충돌 데이터 변환을 이 파일 한 곳에서만 한다.
// NPC 로직(followLogic 등)은 이 어댑터가 만든 값만 보고, 나주 코드를 직접 알지 않는다.
// 플레이어 상자는 읽기만 하며 절대 쓰지 않는다.
import * as THREE from 'three'
import type { CollisionBox, CollisionCircle, CollisionWorld, NavWaypoint } from '../collision.ts'
import { NPC_COLLISION_RADIUS } from '../collision.ts'
import type { FollowTargetPose } from '../followLogic.ts'
import type { NpcTerrain, TerrainSample } from '../terrain.ts'
import { METERS_PER_UNIT, UNITS_PER_METER } from '../units.ts'
import type {
  AvatarLinkLike,
  NajuCoreBounds,
  NajuGroundSample,
  NajuPropCollidersLike,
  NajuTerrainLike,
} from './najuTypes.ts'

export interface NajuNpcSources {
  /** 나주 씬의 playerState (RefObject<AvatarLink>) */
  player: { readonly current: AvatarLinkLike | null }
  /** 지금 씬이 쓰는 terrain 인스턴스 (DEFAULT_TERRAIN 을 따로 쓰지 않는다) */
  terrain: NajuTerrainLike
  /** buildPropColliders(instanceGroups) 결과 */
  props?: NajuPropCollidersLike | null
  coreBounds: NajuCoreBounds
  /** 코어 밖으로 나갈 수 있는 자리(연결로) — 플레이어 이동의 canLeaveCore 와 같은 함수 */
  canLeaveCore?: ((x: number, z: number) => boolean) | null
  /** 1차 통합처럼 NPC 가 다닐 구역을 좁힐 때. false 를 돌려주면 그 땅을 못 걷는 땅으로 본다 */
  isAllowed?: ((x: number, z: number, sample: NajuGroundSample) => boolean) | null
  /** 경로 탐색에 넘길 장애물 범위 (m). 소품이 수백 개라 근처만 본다 */
  obstacleRange?: number
  /** 지형 길목 경유점 (예: 통로 중심선 점들, 미터). 강·절벽 사이 통로를 경로 탐색이 찾게 한다 */
  waypoints?: readonly NavWaypoint[]
}

export interface NajuNpcWorld {
  /** 플레이어 자세를 미터로 읽어 out 에 담는다. 아직 없으면 null */
  readPlayer(out: FollowTargetPose): FollowTargetPose | null
  /** NPC 로직이 쓰는 지형 (미터) */
  terrain: NpcTerrain
  /** (x, z) 근처 장애물만 담은 충돌 세계. 치운 차단물은 빠진다 */
  collisionNear(x: number, z: number): CollisionWorld
  /** 미터 → 나주 월드 좌표(유닛) */
  toWorld(point: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3
}

export const NAJU_ADAPTER_CONFIG = {
  obstacleRange: 10, // m
} as const

function insideCore(bounds: NajuCoreBounds, x: number, z: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
}

export function createNajuNpcWorld(sources: NajuNpcSources): NajuNpcWorld {
  const range = sources.obstacleRange ?? NAJU_ADAPTER_CONFIG.obstacleRange

  const terrain: NpcTerrain = {
    sample(x: number, z: number): TerrainSample {
      const g = sources.terrain.groundAt(x, z)
      if (g.isWater) return { y: g.y, walkable: false, reason: 'water' }
      if (g.isFall) return { y: g.y, walkable: false, reason: 'fall' }
      const canLeave = sources.canLeaveCore ? sources.canLeaveCore(x, z) : false
      if (!insideCore(sources.coreBounds, x, z) && !canLeave) {
        return { y: g.y, walkable: false, reason: 'outside' }
      }
      if (sources.isAllowed && !sources.isAllowed(x, z, g)) {
        return { y: g.y, walkable: false, reason: 'restricted' }
      }
      return { y: g.y, walkable: true, reason: null }
    },
  }

  return {
    readPlayer(out) {
      const link = sources.player.current
      if (!link) return null
      out.position.set(
        link.position.x * METERS_PER_UNIT,
        link.footY * METERS_PER_UNIT,
        link.position.z * METERS_PER_UNIT,
      )
      out.yaw = link.facing
      return out
    },

    terrain,

    collisionNear(x, z) {
      const boxes: CollisionBox[] = []
      for (const b of sources.terrain.blockers) {
        if (sources.terrain.clearedBlockers.has(b.code)) continue
        boxes.push({
          id: b.code,
          minX: b.x[0],
          maxX: b.x[1],
          minZ: b.z[0],
          maxZ: b.z[1],
          minY: b.foot,
          maxY: b.floor + b.height,
        })
      }
      const circles: CollisionCircle[] = []
      const colliders = sources.props?.colliders ?? []
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i]
        if (Math.hypot(c.x - x, c.z - z) - c.radius > range) continue
        // 같은 무리(groupId)의 인스턴스가 여럿이라 순번을 붙여 경유점 키가 겹치지 않게 한다
        circles.push({
          id: `${c.groupId}#${i}`,
          x: c.x,
          z: c.z,
          radius: c.radius,
          minY: c.bottom,
          maxY: c.top,
        })
      }
      return { boxes, circles, radius: NPC_COLLISION_RADIUS, waypoints: sources.waypoints ?? [] }
    },

    toWorld(point, out) {
      return out.set(point.x * UNITS_PER_METER, point.y * UNITS_PER_METER, point.z * UNITS_PER_METER)
    },
  }
}
