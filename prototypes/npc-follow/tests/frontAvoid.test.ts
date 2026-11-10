// 돌아선 플레이어 눈앞을 가로지르지 않는다 — 우회 방향은 보는 쪽 앞(부채꼴)을 덜 지나는 쪽,
// 회전 중 지연된 동행 위치가 눈앞이면 최종 위치로 바로 간다(나주 11/11 「동행이 길을 막는다」)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { planDetourXZ } from '../src/npc/avoidance.ts'
import { createCollisionWorld } from '../src/npc/collision.ts'
import { advanceFollow, createFollowState, FOLLOW_CONFIG } from '../src/npc/followLogic.ts'
import type { FollowTargetPose } from '../src/npc/followLogic.ts'

const OPTIONS = {
  orbitRadius: FOLLOW_CONFIG.detourOrbitRadius,
  lookahead: FOLLOW_CONFIG.detourLookahead,
  switchMargin: FOLLOW_CONFIG.detourSwitchMargin,
}
// 플레이어는 원점에서 +Z 를 본다(yaw 0) — XZ 각도 π/2
const FRONT = { angle: Math.PI / 2, halfWidth: FOLLOW_CONFIG.frontAvoidHalfAngle }
const PLAYER = { x: 0, z: 0, radius: FOLLOW_CONFIG.detourCheckRadius }
// 오른쪽 = (-cos 0, sin 0) = (-1, 0). NPC 는 왼쪽 앞(돌아서기 전의 오른쪽 뒤), 가려는 곳은 오른쪽 뒤
const NPC = new THREE.Vector3(1.0, 1.3, 0.9)
const GOAL = new THREE.Vector3(-1.1, 1.3, -0.8)

/** 플레이어 기준 앞(+Z) 부채꼴 안인가 */
const isInFront = (point: THREE.Vector3) =>
  Math.abs(Math.atan2(point.z, point.x) - Math.PI / 2) < FOLLOW_CONFIG.frontAvoidHalfAngle

test('부채꼴이 없으면 짧은 쪽 — 이 배치에선 플레이어 앞을 지난다(예전 동작)', () => {
  const out = new THREE.Vector3()
  assert.equal(planDetourXZ(NPC, GOAL, PLAYER, 0, OPTIONS, out), 1)
})

test('보는 쪽 앞을 피하면 등 뒤로 돈다 — 경유점이 앞 부채꼴 밖', () => {
  const out = new THREE.Vector3()
  const side = planDetourXZ(NPC, GOAL, PLAYER, 0, { ...OPTIONS, avoid: FRONT }, out)
  assert.equal(side, -1)
  assert.ok(!isInFront(out), `경유점 (${out.x.toFixed(2)}, ${out.z.toFixed(2)}) 이 앞이다`)
})

test('이미 앞으로 돌던 중이어도(previousSide) 앞을 덜 지나는 쪽으로 바꾼다', () => {
  const out = new THREE.Vector3()
  assert.equal(planDetourXZ(NPC, GOAL, PLAYER, 1, { ...OPTIONS, avoid: FRONT }, out), -1)
})

test('앞 부채꼴이 두 길 모두에 비슷하면 예전 규칙(하던 쪽)을 따른다', () => {
  // NPC 가 바로 뒤, 목표가 바로 앞 — 어느 쪽이든 앞을 같은 만큼 지난다
  const out = new THREE.Vector3()
  const from = new THREE.Vector3(0, 1.3, -1.2)
  const goal = new THREE.Vector3(0, 1.3, 1.2)
  assert.equal(planDetourXZ(from, goal, PLAYER, -1, { ...OPTIONS, avoid: FRONT }, out), -1)
  assert.equal(planDetourXZ(from, goal, PLAYER, 1, { ...OPTIONS, avoid: FRONT }, out), 1)
})

// 원점에서 +Z 를 보며 서 있다가 turn 만큼 돌아서 그쪽으로 걸어간다(1.4 m/s, 6초).
// 눈앞 길목 = 앞 1.6 m · 좌우 0.6 m. 처음부터 길목에 있었는지, 길목에 머문 시간, 그동안 가장 가까웠던 앞 거리
function walkAfterTurn(turn: number) {
  const world = createCollisionWorld([])
  const state = createFollowState(new THREE.Vector3(-1.1, 1.3, -0.8))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0 }
  for (let i = 0; i < 60; i++) advanceFollow(state, pose, 0.05, world, true)
  pose.yaw = turn
  const inLane = () => {
    const dx = state.position.x - pose.position.x
    const dz = state.position.z - pose.position.z
    const ahead = dx * Math.sin(turn) + dz * Math.cos(turn)
    const lateral = -dx * Math.cos(turn) + dz * Math.sin(turn)
    return ahead > 0 && ahead < 1.6 && Math.abs(lateral) < 0.6 ? ahead : null
  }
  const startsInLane = inLane() !== null
  let seconds = 0
  let closest = Infinity
  for (let i = 0; i < 120; i++) {
    pose.position.x += Math.sin(turn) * 1.4 * 0.05 // 걷기 — 보는 쪽으로
    pose.position.z += Math.cos(turn) * 1.4 * 0.05
    advanceFollow(state, pose, 0.05, world, true)
    const ahead = inLane()
    if (ahead === null) continue
    seconds += 0.05
    closest = Math.min(closest, ahead)
  }
  return { startsInLane, seconds, closest }
}

for (const [name, turn] of [
  ['돌아서기(180°)', Math.PI],
  ['반대로 돌아서기(-180°)', -Math.PI + 1e-3],
  ['왼쪽 뒤로(135°)', (3 * Math.PI) / 4],
  ['왼쪽으로(90°)', Math.PI / 2],
  ['오른쪽으로(-90°)', -Math.PI / 2],
] as const) {
  test(`추종: ${name} 걸어도 NPC 가 눈앞 길목에 들어오지 않는다`, () => {
    const { startsInLane, seconds, closest } = walkAfterTurn(turn)
    assert.equal(startsInLane, false)
    assert.equal(seconds, 0, `${seconds.toFixed(2)}초 · 앞 ${closest.toFixed(2)} m 까지 들어왔다`)
  })
}

test('추종: NPC 쪽(오른쪽 뒤 135°)으로 돌아서 걸어오면 곧 옆으로 비킨다', () => {
  // 돌아서는 순간 NPC 는 눈앞 1.3 m 다(피할 수 없다) — 0.5초 안에 비키고, 그동안 0.9 m 안으로 들어오지 않는다
  const { startsInLane, seconds, closest } = walkAfterTurn((-3 * Math.PI) / 4)
  assert.equal(startsInLane, true)
  assert.ok(seconds <= 0.5, `${seconds.toFixed(2)}초 머물렀다`)
  assert.ok(closest >= 0.9, `앞 ${closest.toFixed(2)} m 까지 들어왔다`)
})

test('추종: 비킬 쪽이 벽이면 반대쪽으로 비키고, 눈앞에 붙어 남지 않는다(Codex 리뷰 재현)', () => {
  // 플레이어 (0,0) 이 +Z 를 본다. NPC 는 눈앞 (0.3, 1.2) — 오른쪽(-X) 이 아니라 +X 쪽에 치우쳐 있고, +X 쪽 x=1.0~1.2 는 벽
  const world = createCollisionWorld([{ id: 'wall', center: [1.1, 1, 0], size: [0.2, 2, 20] }])
  const state = createFollowState(new THREE.Vector3(0.3, 1.3, 1.2))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0 }
  let laneSeconds = 0
  for (let i = 0; i < 200; i++) {
    advanceFollow(state, pose, 0.05, world, true)
    const ahead = state.position.z
    if (ahead > 0 && ahead < 1.6 && Math.abs(state.position.x) < 0.6) laneSeconds += 0.05
  }
  assert.ok(laneSeconds <= 1.5, `눈앞에 ${laneSeconds.toFixed(2)}초 남았다`)
  assert.ok(state.position.z < 0.2, `뒤로 오지 못했다 (${state.position.x.toFixed(2)}, ${state.position.z.toFixed(2)})`)
})

test('추종: 뒷걸음하면 「뒤」 후보(이때 눈앞 가운데)를 고르지 않는다 — 오른쪽 뒤가 막혀도', () => {
  // +Z 를 보며 -Z 로 뒷걸음. 진행 방향 기준 오른쪽 뒤 · 가까운 오른쪽 뒤 · 왼쪽 뒤를 막는 기둥을 플레이어와 함께 옮길 수 없으니
  // 장애물 대신 결과만 본다: 걷는 동안 NPC 가 눈앞 길목(앞 1.6 m · 좌우 0.6 m)에 머문 시간
  const world = createCollisionWorld([])
  const state = createFollowState(new THREE.Vector3(-1.1, 1.3, -0.8))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0 }
  for (let i = 0; i < 60; i++) advanceFollow(state, pose, 0.05, world, true)
  let laneSeconds = 0
  for (let i = 0; i < 120; i++) {
    pose.position.z -= 1.0 * 0.05
    advanceFollow(state, pose, 0.05, world, true)
    const ahead = state.position.z - pose.position.z
    const lateral = -(state.position.x - pose.position.x)
    if (ahead > 0 && ahead < 1.6 && Math.abs(lateral) < 0.6) laneSeconds += 0.05
  }
  assert.ok(laneSeconds <= 0.3, `눈앞에 ${laneSeconds.toFixed(2)}초 있었다`)
})

test('추종: 서서 둘러보기만 하면 NPC 를 쳐다봐도 달아나지 않는다', () => {
  const world = createCollisionWorld([])
  const state = createFollowState(new THREE.Vector3(-1.1, 1.3, -0.8))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0 }
  for (let i = 0; i < 60; i++) advanceFollow(state, pose, 0.05, world, true)
  const before = state.position.clone()
  pose.yaw = Math.atan2(before.x, before.z) // NPC 쪽을 본다
  for (let i = 0; i < 60; i++) advanceFollow(state, pose, 0.05, world, true)
  assert.ok(state.position.distanceTo(before) < 0.3, `${state.position.distanceTo(before).toFixed(2)} m 움직였다`)
})

test('걷기 판정: 한 프레임을 여러 걸음으로 나눠 불러도(같은 위치) 빠르기가 출렁이지 않는다(Codex 리뷰)', () => {
  // 0.28 m/s 로 걷고 프레임은 0.1초 — 나주 CompanionNpc 처럼 한 프레임을 0.05초 두 걸음으로 나눈다
  const world = createCollisionWorld([])
  const state = createFollowState(new THREE.Vector3(-1.1, 1.3, -0.8))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0 }
  const speeds: number[] = []
  for (let frame = 0; frame < 100; frame++) {
    pose.position.z += 0.28 * 0.1
    for (let step = 0; step < 2; step++) {
      advanceFollow(state, pose, 0.05, world, true)
      if (frame > 50) speeds.push(state.playerSpeed)
    }
  }
  const spread = Math.max(...speeds) - Math.min(...speeds)
  assert.ok(spread < 0.03, `빠르기가 ${spread.toFixed(3)} m/s 출렁였다`)
  assert.ok(Math.abs(speeds[speeds.length - 1] - 0.28) < 0.03)
})

test('비키기 시간: 길목을 벗어나면(추적 중이 아니어도) 비운다(Codex 리뷰)', () => {
  const world = createCollisionWorld([])
  const state = createFollowState(new THREE.Vector3(-1.1, 1.3, -0.8))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0 }
  advanceFollow(state, pose, 0.05, world, true)
  state.laneEscapeTime = 5 // 다 써 버린 상태
  // NPC 는 오른쪽 뒤 — 눈앞 길목 밖이다
  advanceFollow(state, pose, 0.05, world, true)
  assert.equal(state.laneEscapeTime, 0)
})

test('걷기 판정: 부르는 쪽이 빠르기를 넘기면 프레임 길이가 들쭉날쭉해도 출렁이지 않는다(Codex 리뷰 3차)', () => {
  // 0.28 m/s, 프레임 0.1초 · 0.2초를 번갈아 — 나주 CompanionNpc 처럼 0.05초 걸음으로 나누고, 프레임 빠르기를 pose.speed 로
  const world = createCollisionWorld([])
  const state = createFollowState(new THREE.Vector3(-1.1, 1.3, -0.8))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0, speed: 0.28 }
  const walking: boolean[] = []
  const speeds: number[] = []
  for (let frame = 0; frame < 100; frame++) {
    const frameTime = frame % 2 === 0 ? 0.1 : 0.2
    pose.position.z += 0.28 * frameTime
    for (let left = frameTime; left > 1e-6; left -= 0.05) {
      advanceFollow(state, pose, Math.min(left, 0.05), world, true)
      if (frame > 50) {
        speeds.push(state.playerSpeed)
        walking.push(state.isPlayerWalking)
      }
    }
  }
  assert.ok(Math.max(...speeds) - Math.min(...speeds) < 0.01)
  assert.equal(new Set(walking).size, 1, '걷기 판정이 바뀌었다')
})

test('걷기 판정: 넘겨받은 빠르기가 남아 있어도 위치가 그대로면(화면 고정 · 경계) 선 것으로 본다(Codex 리뷰 5차)', () => {
  const world = createCollisionWorld([])
  const state = createFollowState(new THREE.Vector3(-1.1, 1.3, -0.8))
  const pose: FollowTargetPose = { position: new THREE.Vector3(0, 0, 0), yaw: 0, speed: 1.4 }
  for (let i = 0; i < 40; i++) {
    pose.position.z += 1.4 * 0.05
    advanceFollow(state, pose, 0.05, world, true)
  }
  assert.equal(state.isPlayerWalking, true)
  // 걷기 훅은 여전히 1.4 m/s 를 적지만 위치는 멈췄다
  for (let i = 0; i < 20; i++) advanceFollow(state, pose, 0.05, world, true)
  assert.equal(state.isPlayerWalking, false)
})
