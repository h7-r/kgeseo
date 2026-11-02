// [Stage 0 신규] mock 나주 맵 통합 주행 — 20 / 30 / 144 fps
// 매 프레임 확인하는 불변식:
//   ① 장애물(차단물 상자·소품 원기둥) 관통 없음
//   ② 못 걷는 땅(강·벼랑면·허용 구역 밖)에 서지 않음
//   ③ 순간이동 없음 — 한 프레임 이동량 ≤ (NPC 최고 속도 + 플레이어 속도) × dt
//   ④ 추적 높이 = 발밑 지면 + 부유 기준 높이
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { advanceFollow, createFollowState, FOLLOW_CONFIG, stepFollow } from '../src/npc/followLogic.ts'
import type { FollowState, FollowTargetPose } from '../src/npc/followLogic.ts'
import { NPC_COLLISION_RADIUS } from '../src/npc/collision.ts'
import type { CollisionWorld } from '../src/npc/collision.ts'
import { HOVER_CONFIG } from '../src/npc/hover.ts'
import { groundHeight } from '../src/npc/terrain.ts'
import type { NpcTerrain } from '../src/npc/terrain.ts'
import { createNajuNpcWorld } from '../src/npc/naju/najuNpcAdapter.ts'
import {
  createMockAvatarLink,
  createMockNajuMap,
  isFlatTestArea,
  MOCK_CORE_BOUNDS,
  MOCK_LEDGE,
  MOCK_WAYPOINTS,
  placeMockPlayer,
} from '../src/npc/naju/mockNajuMap.ts'

const FPS = [20, 30, 144] as const
const R = NPC_COLLISION_RADIUS

interface PlayerFrame {
  x: number
  z: number
  speed?: number // m/s (밀어내기 허용치 계산용)
  facing?: number
}

interface ScenarioOptions {
  fps: number
  duration: number
  npcStart: [number, number]
  player: (t: number) => PlayerFrame
  restricted?: boolean
  // t 초에 차단물을 치운다
  clearAt?: { t: number; code: string }
  // t 초에 행동 상태 (true = Follow)
  active?: (t: number) => boolean
  onFrame?: (t: number, state: FollowState, world: CollisionWorld) => void
}

function penetration(world: CollisionWorld, p: THREE.Vector3): number {
  let worst = -Infinity
  for (const c of world.circles) {
    if (!(p.y + R > c.minY && p.y - R < c.maxY)) continue
    worst = Math.max(worst, c.radius + R - Math.hypot(p.x - c.x, p.z - c.z))
  }
  for (const b of world.boxes) {
    if (!(p.y + R > b.minY && p.y - R < b.maxY)) continue
    const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX)
    const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ)
    worst = Math.max(worst, R - Math.hypot(dx, dz))
  }
  return worst
}

function run(o: ScenarioOptions) {
  const map = createMockNajuMap()
  const first = o.player(0)
  const link = createMockAvatarLink(first.x, first.z, first.facing ?? Math.PI)
  const world = createNajuNpcWorld({
    player: { current: link },
    terrain: map.terrain,
    props: map.props,
    coreBounds: MOCK_CORE_BOUNDS,
    isAllowed: o.restricted === false ? null : isFlatTestArea,
    waypoints: MOCK_WAYPOINTS,
  })
  const state = createFollowState(new THREE.Vector3(o.npcStart[0], 0, o.npcStart[1]))
  const pose: FollowTargetPose = { position: new THREE.Vector3(), yaw: 0 }
  const dt = 1 / o.fps
  const metrics = {
    maxPenetration: -Infinity,
    forbiddenFrames: 0,
    maxStepRatio: 0, // 한 프레임 이동량 ÷ 허용치 (1 이하여야 함)
    maxHeightError: 0,
    waitingFrames: 0,
    blockedFrames: 0,
    terrainBlockedFrames: 0, // 지형 검사(guardTerrainMove)가 실제로 이동을 막은 프레임
    teleportCount: 0,
  }
  const before = new THREE.Vector3()
  let cleared = false
  for (let t = dt; t <= o.duration + 1e-9; t += dt) {
    const frame = o.player(t)
    placeMockPlayer(link, frame.x, frame.z, frame.speed ?? 0)
    if (frame.facing !== undefined) link.facing = frame.facing
    if (o.clearAt && !cleared && t >= o.clearAt.t) {
      map.terrain.clearedBlockers.add(o.clearAt.code)
      cleared = true
    }
    world.readPlayer(pose)
    before.copy(state.position)
    const collision = world.collisionNear(state.position.x, state.position.z)
    const active = o.active ? o.active(t) : true
    if (o.active) advanceFollow(state, pose, Math.min(dt, 0.05), collision, active, world.terrain)
    else stepFollow(state, pose, Math.min(dt, 0.05), collision, world.terrain)

    const p = state.position
    metrics.maxPenetration = Math.max(metrics.maxPenetration, penetration(collision, p))
    if (!world.terrain.sample(p.x, p.z).walkable) metrics.forbiddenFrames++
    const allowed = (FOLLOW_CONFIG.maxSpeed + (frame.speed ?? 0)) * Math.min(dt, 0.05) + 1e-6
    const moved = Math.hypot(p.x - before.x, p.z - before.z)
    metrics.maxStepRatio = Math.max(metrics.maxStepRatio, moved / allowed)
    if (active) {
      const expectedY = groundHeight(world.terrain, p.x, p.z) + HOVER_CONFIG.baseHeight
      metrics.maxHeightError = Math.max(metrics.maxHeightError, Math.abs(p.y - expectedY))
    }
    if (state.waiting) metrics.waitingFrames++
    if (state.path.status === 'blocked') metrics.blockedFrames++
    if (state.terrainBlocked) metrics.terrainBlockedFrames++
    o.onFrame?.(t, state, collision)
  }
  metrics.teleportCount = state.teleportCount
  const last = o.player(o.duration)
  const distanceToPlayer = Math.hypot(state.position.x - last.x, state.position.z - last.z)
  return { state, metrics, distanceToPlayer }
}

function assertInvariants(name: string, fps: number, m: ReturnType<typeof run>['metrics']) {
  const tag = `${name} @${fps}fps`
  assert.ok(m.maxPenetration <= 1e-3, `${tag}: 관통 ${m.maxPenetration}`)
  assert.equal(m.forbiddenFrames, 0, `${tag}: 못 걷는 땅에 선 프레임`)
  assert.ok(m.maxStepRatio <= 1, `${tag}: 한 프레임 이동 비율 ${m.maxStepRatio}`)
  assert.ok(m.maxHeightError <= 1e-9, `${tag}: 높이 오차 ${m.maxHeightError}`)
}

// 경유 지점들을 일정 속도로 걷는 플레이어
function walk(points: [number, number][], speed: number): (t: number) => PlayerFrame {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]))
  const total = lengths.reduce((a, b) => a + b, 0)
  return (t) => {
    let d = Math.min(t * speed, total)
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i] || i === lengths.length - 1) {
        const k = lengths[i] > 0 ? Math.min(1, d / lengths[i]) : 1
        const [ax, az] = points[i]
        const [bx, bz] = points[i + 1]
        const moving = t * speed < total
        return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, speed: moving ? speed : 0, facing: Math.atan2(bx - ax, bz - az) }
      }
      d -= lengths[i]
    }
    const [x, z] = points[points.length - 1]
    return { x, z }
  }
}

for (const fps of FPS) {
  test(`[기존 동작 + 원형 소품] Z1 나무·울타리 사이 추적 @${fps}fps`, () => {
    const r = run({
      fps,
      duration: 16,
      npcStart: [10.5, 36],
      player: walk([[11, 37], [16, 38], [22, 42], [12, 42], [12, 35]], 1.4),
    })
    assertInvariants('Z1 추적', fps, r.metrics)
    assert.ok(r.distanceToPlayer < 2.5, `플레이어 곁으로 돌아옴: ${r.distanceToPlayer.toFixed(2)} m`)
  })

  test(`[강] 강가를 따라 걸어도 NPC 는 물에 들어가지 않는다 @${fps}fps`, () => {
    // +x 로 걸으면 오른쪽이 강(+z) — 기본 동행 위치가 물 위에 놓인다
    const r = run({ fps, duration: 14, npcStart: [11, 42], player: walk([[12, 43.6], [27, 43.6]], 1.2) })
    assertInvariants('강가', fps, r.metrics)
    assert.ok(r.distanceToPlayer < 3, `${r.distanceToPlayer.toFixed(2)} m`)
  })

  test(`[높은 턱] 턱 옆에 서도 NPC 는 턱 위로 오르지 않는다 @${fps}fps`, () => {
    // 턱(x 44–48, z 34–38, 0.8 m) 남쪽 z=38.9 를 -x 로 걸으면 기본 동행 위치(오른쪽 1.1 m = z 37.8)가 턱 위에 놓인다
    let onLedgeFrames = 0
    const r = run({
      fps,
      duration: 12,
      npcStart: [51, 40],
      player: walk([[50, 38.9], [45.5, 38.9]], 1.2),
      onFrame: (_t, state) => {
        const p = state.position
        if (p.x > MOCK_LEDGE.x[0] && p.x < MOCK_LEDGE.x[1] && p.z > MOCK_LEDGE.z[0] && p.z < MOCK_LEDGE.z[1]) {
          onLedgeFrames++
        }
      },
    })
    assertInvariants('높은 턱', fps, r.metrics)
    assert.equal(onLedgeFrames, 0, '턱 위에 올라간 프레임')
  })

  test(`[절벽 위 텔레포트] 플레이어가 Z3(고도 14)로 옮겨지면 NPC 는 따라 순간이동하지 않고 대기 @${fps}fps`, () => {
    const r = run({
      fps,
      duration: 6,
      npcStart: [15, 38],
      player: (t) => (t < 2 ? { x: 16, z: 38.5 } : { x: 45, z: 15 }),
    })
    assertInvariants('절벽 위 텔레포트', fps, r.metrics)
    assert.equal(r.metrics.teleportCount, 1)
    assert.ok(r.metrics.waitingFrames > 0, '갈 수 있는 동행 위치가 없어 대기')
    assert.ok(r.state.position.z > 30, `NPC 는 Z1·Z2 안에 남는다 z=${r.state.position.z.toFixed(2)}`)
  })

  test(`[평지 텔레포트] Z1 → Z2 로 옮겨지면 T1 통로로 걸어서 따라간다 @${fps}fps`, () => {
    const r = run({
      fps,
      duration: 25,
      npcStart: [14, 37.5],
      player: (t) => (t < 1.5 ? { x: 15, z: 38.5 } : { x: 44, z: 41 }),
    })
    assertInvariants('평지 텔레포트', fps, r.metrics)
    assert.equal(r.metrics.teleportCount, 1)
    assert.ok(r.distanceToPlayer < 2.5, `Z2 플레이어 곁 도착: ${r.distanceToPlayer.toFixed(2)} m`)
  })

  test(`[차단물 치움] 치운 뒤에는 그 자리를 지나갈 수 있다 @${fps}fps`, () => {
    let insideBefore = 0
    let insideAfter = 0
    const r = run({
      fps,
      duration: 14,
      npcStart: [16.5, 35.5],
      // B9(x 18–20, z 33–38) 동쪽에 서 있다가 잠시 뒤 서쪽으로 가로질러 간다
      player: (t) => (t < 4 ? { x: 21.5, z: 35.5, facing: Math.PI / 2 } : walk([[21.5, 35.5], [15, 35.5]], 1.0)(t - 4)),
      clearAt: { t: 3, code: 'B9' },
      onFrame: (t, state) => {
        const p = state.position
        const inside = p.x > 18 && p.x < 20 && p.z > 33 && p.z < 38
        if (inside && t < 3) insideBefore++
        if (inside && t >= 3) insideAfter++
      },
    })
    assertInvariants('차단물 치움', fps, r.metrics)
    assert.equal(insideBefore, 0, '치우기 전에는 들어가지 않는다')
    assert.ok(insideAfter > 0, '치운 뒤에는 그 자리를 지난다')
  })

  test(`[부두 끝] 좁은 부두 끝으로 밀려도 물에 빠지지 않는다 (지형 검사 작동) @${fps}fps`, () => {
    // 폭 1.2 m 부두(|x| ≤ 0.6, z ≥ 0) 밖은 전부 물 — 플레이어 곁을 비켜 지나갈 수 없다.
    // (폭 2 m 이면 NPC 가 플레이어 옆으로 비켜 뒤쪽 동행 위치로 가 버려 밀리는 상황이 안 생긴다)
    // 플레이어가 부두 끝의 NPC 쪽으로 걸어와 민다.
    const pier: NpcTerrain = {
      sample: (x, z) =>
        Math.abs(x) <= 0.6 && z >= 0
          ? { y: 0, walkable: true, reason: null }
          : { y: -1, walkable: false, reason: 'water' },
    }
    const dt = 1 / fps
    const state = createFollowState(new THREE.Vector3(0, 0, 0.6))
    const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 8), yaw: Math.PI }
    let offPier = 0
    let terrainBlocked = 0
    let maxStepRatio = 0
    for (let t = dt; t <= 8 + 1e-9; t += dt) {
      // 플레이어가 z = 0.5 까지 오면 최소 이격(0.75 m) 때문에 NPC 는 z < 0(물) 쪽으로 밀린다
      const z = Math.max(0.5, 8 - t * 1.0)
      pose.position.set(0, 0, z)
      const before = state.position.clone()
      stepFollow(state, pose, Math.min(dt, 0.05), null, pier)
      const p = state.position
      if (!pier.sample(p.x, p.z).walkable) offPier++
      if (state.terrainBlocked) terrainBlocked++
      const allowed = (FOLLOW_CONFIG.maxSpeed + 1.0) * Math.min(dt, 0.05) + 1e-6
      maxStepRatio = Math.max(maxStepRatio, Math.hypot(p.x - before.x, p.z - before.z) / allowed)
    }
    assert.equal(offPier, 0, '부두 밖(물)에 선 프레임')
    assert.ok(terrainBlocked > 0, '지형 검사가 실제로 물 쪽 이동을 막았다')
    assert.ok(maxStepRatio <= 1, `순간이동 없음 (비율 ${maxStepRatio})`)
  })

  test(`[못 걷는 땅에서 시작] 허용 구역 밖에 놓인 NPC 는 빠져나온 뒤 다시 들어가지 않는다 @${fps}fps`, () => {
    let firstWalkable = -1
    let reentered = 0
    const r = run({
      fps,
      duration: 6,
      npcStart: [20, 44.2], // Z1(z ≤ 44)과 강(z ≥ 44.5) 사이 — 허용 구역 밖
      player: () => ({ x: 20, z: 40 }),
      onFrame: (t, state) => {
        const sample = createMockNajuMap().terrain.groundAt(state.position.x, state.position.z)
        const inside = isFlatTestArea(state.position.x, state.position.z, sample)
        if (inside && firstWalkable < 0) firstWalkable = t
        if (!inside && firstWalkable >= 0) reentered++
      },
    })
    assert.ok(firstWalkable >= 0 && firstWalkable < 1.0, `빠져나온 시각 ${firstWalkable.toFixed(2)} s`)
    assert.equal(reentered, 0, '다시 허용 구역 밖으로 나간 프레임')
    assert.ok(r.metrics.maxPenetration <= 1e-3)
    assert.ok(r.metrics.maxStepRatio <= 1)
    assert.ok(r.distanceToPlayer < 2.5, `${r.distanceToPlayer.toFixed(2)} m`)
  })

  test(`[행동 상태] Idle 동안 지형 위에서 정지, Follow 로 돌아오면 재개 @${fps}fps`, () => {
    let idleDrift = 0
    let idleStart: THREE.Vector3 | null = null
    const r = run({
      fps,
      duration: 10,
      npcStart: [13, 38],
      player: walk([[14, 38.5], [24, 38.5]], 1.2),
      active: (t) => !(t >= 1 && t < 5),
      onFrame: (t, state) => {
        if (t >= 1 && t < 5) {
          idleStart ??= state.position.clone()
          idleDrift = Math.max(idleDrift, state.position.distanceTo(idleStart))
        }
      },
    })
    assertInvariants('행동 상태', fps, r.metrics)
    assert.equal(idleDrift, 0, 'Idle 중 이동')
    assert.ok(r.distanceToPlayer < 2.5, `Follow 재개 후 도착: ${r.distanceToPlayer.toFixed(2)} m`)
  })
}
