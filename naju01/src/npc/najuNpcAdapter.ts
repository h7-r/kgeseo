// 나주 맵 ↔ NPC 로직 연결. 단위 변환·지형 판정·충돌 데이터 변환을 이 파일 한 곳에서만 한다.
// NPC 로직(followLogic 등)은 이 어댑터가 만든 값만 보고 나주 코드를 직접 알지 않는다.
// 플레이어 상자(AvatarLink)는 읽기만 하며 절대 쓰지 않는다.
import * as THREE from "three";

import type { AvatarLink } from "@/engine/avatarLink";

import type { buildPropColliders } from "../movement/propColliders";
import { CORE_BOUNDS, type Terrain } from "../terrain/terrain";
import {
  NPC_COLLISION_RADIUS,
  type CollisionBox,
  type CollisionCircle,
  type CollisionWorld,
  type NavWaypoint,
} from "./collision";
import type { FollowTargetPose } from "./followLogic";
import { npcProfile } from "./npcProfiler";
import { classifyProps } from "./propHeightFilter";
import type { NpcTerrain, TerrainSample } from "./terrain";
import { METERS_PER_UNIT, UNITS_PER_METER } from "./units";

/** buildPropColliders(instanceGroups) 결과 (미터) */
export type NajuPropColliders = ReturnType<typeof buildPropColliders>;
/** terrain.groundAt 결과 (미터) — 나주 쪽 타입이 export 되지 않아 반환형으로 받는다 */
export type NajuGroundSample = ReturnType<Terrain["groundAt"]>;
export type NajuCoreBounds = typeof CORE_BOUNDS;

export interface NajuNpcSources {
  /** 나주 씬의 playerState. 읽기만 한다 */
  playerState: { readonly current: AvatarLink | null };
  /** 지금 씬이 쓰는 terrain 인스턴스 (DEFAULT_TERRAIN 을 따로 쓰지 않는다 — 절벽 높이·높이표·치운 차단물이 반영된 것) */
  terrain: Terrain;
  /** buildPropColliders(instanceGroups) 결과. 없으면 소품을 무시한다 */
  props?: NajuPropColliders | null;
  /** 기본은 나주의 CORE_BOUNDS */
  coreBounds?: NajuCoreBounds;
  /** 코어 밖으로 나갈 수 있는 자리(연결로) — 플레이어 이동의 canLeaveCore 와 같은 함수 (미터) */
  canLeaveCore?: ((x: number, z: number) => boolean) | null;
  /** NPC 가 다닐 구역을 좁힐 때. false 면 그 땅을 못 걷는 땅으로 본다 (예: 1차 통합의 평탄 구역) */
  isAllowed?: ((x: number, z: number, sample: NajuGroundSample) => boolean) | null;
  /** 경로 탐색에 넘길 소품 범위 (m). 소품이 수백 개라 근처만 본다 */
  obstacleRange?: number;
  /** 지형 길목 경유점 (미터). 보통 pathCenterlineWaypoints(terrain) 결과를 넘긴다 */
  waypoints?: readonly NavWaypoint[];
}

export interface NajuNpcWorld {
  /** 플레이어 자세를 미터·발 높이로 읽어 out 에 담는다. 아직 없으면 null */
  readPlayer(out: FollowTargetPose): FollowTargetPose | null;
  /** NPC 로직이 쓰는 지형 (미터) */
  terrain: NpcTerrain;
  /**
   * (x, z) 근처 장애물만 담은 충돌 세계. 치운 차단물은 빠진다.
   * 매 프레임 부르므로 같은 객체·배열을 고쳐 써서 돌려준다 — 다음 호출 전까지만 유효하다.
   */
  collisionNear(x: number, z: number): CollisionWorld;
  /** 미터 → 나주 월드 좌표(유닛) */
  toWorld(point: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3;
  /** 소품 높이 필터 결과 (초기화 때 한 번 정함). 개발 도구·검사용 */
  readonly propFilter: { total: number; blocking: number; samples: number };
}

export const NAJU_ADAPTER_CONFIG = {
  obstacleRange: 10, // m
  waypointSpacing: 2, // 통로 중심선에서 경유점을 뽑는 간격 (m)
} as const;

function insideCore(bounds: NajuCoreBounds, x: number, z: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

/**
 * 통로(T1~T4) 중심선에서 경유점을 뽑는다. 강·절벽 사이 좁은 길은 장애물 꼭짓점만으로는
 * 경로 탐색이 찾지 못하므로 이 점들로 잇는다. 중심선은 terrain.measuredPaths 의 실측값을 쓴다.
 */
export function pathCenterlineWaypoints(
  terrain: Terrain,
  spacing: number = NAJU_ADAPTER_CONFIG.waypointSpacing,
): NavWaypoint[] {
  const waypoints: NavWaypoint[] = [];
  for (const path of terrain.measuredPaths) {
    let nextArc = 0;
    path.centerline.forEach((point, index) => {
      const isLast = index === path.centerline.length - 1;
      if (point.arcLength + 1e-9 < nextArc && !isLast) return;
      waypoints.push({ id: `${path.code}-${waypoints.length}`, x: point.x, z: point.z });
      nextArc = point.arcLength + spacing;
    });
  }
  return waypoints;
}

/** 충돌 세계 판 번호 수열 (CollisionWorld.revision) */
let nextWorldRevision = 1;

export function createNajuNpcWorld(sources: NajuNpcSources): NajuNpcWorld {
  const range = sources.obstacleRange ?? NAJU_ADAPTER_CONFIG.obstacleRange;
  const bounds = sources.coreBounds ?? CORE_BOUNDS;
  // collisionNear 가 매 프레임 고쳐 쓰는 버퍼. 소품 목록(props)이 바뀌면 어댑터를 새로 만든다.
  const boxes: CollisionBox[] = [];
  const circles: CollisionCircle[] = [];
  const colliderIds: string[] = [];
  const colliders = sources.props?.colliders ?? [];
  // 소품이 NPC 를 막는지는 여기서 한 번만 정한다(propHeightFilter). 높이로 매 프레임 다시 가르지 않는다.
  const propFilter = classifyProps(sources.terrain.groundAt, colliders);
  const blocksNpc = propFilter.blocks;
  // 판 번호는 어댑터마다(= 지형·소품이 바뀔 때마다) 새로 받고, 차단물 구성이 바뀌면 다시 받는다.
  // 번호는 모든 어댑터가 함께 쓰는 하나의 수열이라 월드를 갈아끼워도 지난 판과 겹치지 않는다.
  const world: CollisionWorld = {
    boxes,
    circles,
    radius: NPC_COLLISION_RADIUS,
    waypoints: sources.waypoints ?? [],
    revision: nextWorldRevision++,
  };
  let blockerMask = -1;

  const terrain: NpcTerrain = {
    sample(x: number, z: number): TerrainSample {
      if (npcProfile.enabled) npcProfile.counters.terrainSamples++;
      const g = sources.terrain.groundAt(x, z);
      if (g.isWater) return { y: g.y, walkable: false, reason: "water" };
      if (g.isFall) return { y: g.y, walkable: false, reason: "fall" };
      const canLeave = sources.canLeaveCore ? sources.canLeaveCore(x, z) : false;
      if (!insideCore(bounds, x, z) && !canLeave) return { y: g.y, walkable: false, reason: "outside" };
      if (sources.isAllowed && !sources.isAllowed(x, z, g)) return { y: g.y, walkable: false, reason: "restricted" };
      return { y: g.y, walkable: true, reason: null };
    },
  };

  return {
    readPlayer(out) {
      const link = sources.playerState.current;
      if (!link) return null;
      // position 은 유닛·눈높이, footY 는 유닛 발바닥 — NPC 는 미터·발 높이로 본다
      out.position.set(
        link.position.x * METERS_PER_UNIT,
        link.footY * METERS_PER_UNIT,
        link.position.z * METERS_PER_UNIT,
      );
      out.yaw = link.facing;
      return out;
    },

    terrain,

    collisionNear(x, z) {
      // 치운 차단물은 부를 때마다 다시 읽는다 — 씬이 끝나 차단물이 치워지면 다음 프레임부터 빠진다.
      // 남은 차단물 구성(비트 묶음)이 바뀌면 판 번호를 올려 지난 우회 경로·후보 검사 결과를 버리게 한다.
      let boxCount = 0;
      let mask = 0;
      const blockers = sources.terrain.blockers;
      for (let index = 0; index < blockers.length; index++) {
        const b = blockers[index];
        if (sources.terrain.clearedBlockers.has(b.code)) continue;
        mask |= 1 << (index % 31);
        const box = (boxes[boxCount] ??= { id: "", minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
        box.id = b.code;
        box.minX = b.x[0];
        box.maxX = b.x[1];
        box.minZ = b.z[0];
        box.maxZ = b.z[1];
        box.minY = b.foot;
        box.maxY = b.floor + b.height;
        boxCount++;
      }
      boxes.length = boxCount;
      if (blockerMask !== -1 && mask !== blockerMask) world.revision = nextWorldRevision++;
      blockerMask = mask;

      let circleCount = 0;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (!blocksNpc[i]) continue;
        if (Math.hypot(c.x - x, c.z - z) - c.radius > range) continue;
        const circle = (circles[circleCount] ??= { id: "", x: 0, z: 0, radius: 0, minY: 0, maxY: 0 });
        // 같은 무리(groupId)의 인스턴스가 여럿이라 순번을 붙여 경유점 키가 겹치지 않게 한다.
        // 소품 목록이 같으면 키도 같아 한 번만 만든다.
        circle.id = colliderIds[i] ??= `${c.groupId}#${i}`;
        circle.x = c.x;
        circle.z = c.z;
        circle.radius = c.radius;
        // 막는지는 propBlocksHoveringNpc 가 미리 정했다 — 높이로 다시 가르지 않게 위아래를 열어 둔다
        circle.minY = -Infinity;
        circle.maxY = Infinity;
        circleCount++;
      }
      circles.length = circleCount;
      return world;
    },

    toWorld(point, out) {
      return out.set(point.x * UNITS_PER_METER, point.y * UNITS_PER_METER, point.z * UNITS_PER_METER);
    },

    propFilter: { total: colliders.length, blocking: propFilter.blocking, samples: propFilter.samples },
  };
}
