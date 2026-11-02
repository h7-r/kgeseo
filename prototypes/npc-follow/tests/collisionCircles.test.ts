// [Stage 0 신규] 원형 장애물 충돌·우회 및 상자와의 혼합 처리
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  createCollisionWorld,
  createMoveResult,
  isPointClear,
  isSegmentClear,
  moveAndSlide,
  NPC_COLLISION_RADIUS,
  resolvePenetration,
} from '../src/npc/collision.ts'
import type { CollisionCircle, CollisionWorld } from '../src/npc/collision.ts'
import { createPathState, planPath } from '../src/npc/pathfinding.ts'
import type { BoxObstacle } from '../src/world/testMap.ts'

const R = NPC_COLLISION_RADIUS
const Y = 1.3 // NPC 추적 높이 (지면 0 + 부유 기준)
const tree = (id: string, x: number, z: number, radius: number, maxY = 5): CollisionCircle => ({
  id,
  x,
  z,
  radius,
  minY: 0,
  maxY,
})

// 원·상자 모두에 대해 NPC 구체가 파고든 깊이 (양수면 관통)
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

test('원기둥 정면 돌진: 한 번에 5 m 를 가도 표면에서 멈춘다 (터널링 없음)', () => {
  const world = createCollisionWorld([], R, [tree('t', 3, 0, 0.5)])
  const p = new THREE.Vector3(0, Y, 0)
  const result = moveAndSlide(world, p, new THREE.Vector3(5, 0, 0), createMoveResult())
  assert.equal(result.blocked, true)
  assert.equal(result.hitId, 't')
  assert.ok(Math.abs(p.x - (3 - 0.5 - R - 0.002)) < 1e-6, `x=${p.x}`)
  assert.ok(penetration(world, p) <= 1e-9)
})

test('원기둥에 비스듬히 닿으면 둘레를 따라 미끄러진다', () => {
  const world = createCollisionWorld([], R, [tree('t', 3, 0, 0.5)])
  const p = new THREE.Vector3(0, Y, 0.3)
  moveAndSlide(world, p, new THREE.Vector3(4, 0, 0), createMoveResult())
  assert.ok(p.z > 0.3, '옆으로 비켜났다')
  assert.ok(p.x > 2.0, `앞으로도 나아갔다 x=${p.x}`)
  assert.ok(penetration(world, p) <= 1e-9)
})

test('NPC 높이보다 낮은 소품(발목 높이)은 막지 않는다', () => {
  const world = createCollisionWorld([], R, [tree('stone', 3, 0, 0.5, 0.4)])
  const p = new THREE.Vector3(0, Y, 0)
  const result = moveAndSlide(world, p, new THREE.Vector3(5, 0, 0), createMoveResult())
  assert.equal(result.blocked, false)
  assert.equal(p.x, 5)
})

test('원기둥 안에서 시작하면 바깥으로 밀어낸다', () => {
  const world = createCollisionWorld([], R, [tree('t', 0, 0, 0.5)])
  const p = new THREE.Vector3(0.2, Y, 0)
  assert.equal(resolvePenetration(world, p), true)
  assert.ok(Math.hypot(p.x, p.z) >= 0.5 + R)
})

test('선분·점 판정이 원기둥을 고려한다', () => {
  const world = createCollisionWorld([], R, [tree('t', 0, 0, 0.5)])
  const a = new THREE.Vector3(-3, Y, 0)
  assert.equal(isSegmentClear(world, a, new THREE.Vector3(3, Y, 0), Y), false)
  assert.equal(isSegmentClear(world, a, new THREE.Vector3(-3, Y, 3), Y), true)
  assert.equal(isPointClear(world, 0.7, 0, Y), false)
  assert.equal(isPointClear(world, 0.9, 0, Y), true)
})

test('상자와 원기둥이 섞인 길: 경로 탐색이 둘 다 피해 우회한다', () => {
  // x=0 에 남북으로 긴 벽(z -3~3), 벽 북쪽 끝 바로 옆에 나무 — 북쪽 틈은 좁아져 막히고 남쪽으로 돈다
  const wall: BoxObstacle = { id: 'wall', center: [0, 1, 0], size: [0.5, 2, 6] }
  const world = createCollisionWorld([wall], R, [tree('t', 0, 3.7, 0.5)])
  const from = new THREE.Vector3(-3, Y, 0)
  const goal = new THREE.Vector3(3, Y, 0)
  const path = planPath(world, from, goal, createPathState())
  assert.equal(path.status, 'detour')
  // 계획된 꺾은선의 모든 구간이 장애물에 닿지 않는다
  let previous = from
  for (const point of path.points) {
    assert.ok(isSegmentClear(world, previous, point, Y), `${previous.toArray()} → ${point.toArray()}`)
    previous = point
  }
  const waypoints = path.points.slice(0, -1) // 마지막은 목표
  assert.ok(waypoints.length > 0 && waypoints.every((point) => point.z < 0), '좁아진 북쪽이 아니라 남쪽으로 돈다')
})

test('원기둥에 사방이 둘러싸인 목표: 길이 없으면 blocked (대기)', () => {
  const circles: CollisionCircle[] = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    circles.push(tree(`ring${i}`, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.5))
  }
  const world = createCollisionWorld([], R, circles)
  const path = planPath(world, new THREE.Vector3(-6, Y, 0), new THREE.Vector3(0, Y, 0), createPathState())
  assert.equal(path.status, 'blocked')
})

test('원기둥 숲을 지나는 프레임 단위 이동: 20/30/144 fps 모두 관통 없음', () => {
  const circles: CollisionCircle[] = []
  for (let i = 0; i < 5; i++) for (let j = -2; j <= 2; j++) circles.push(tree(`f${i}_${j}`, 2 + i * 1.6, j * 1.6, 0.35))
  const world = createCollisionWorld([], R, circles)
  for (const fps of [20, 30, 144]) {
    const p = new THREE.Vector3(-2, Y, 0.4)
    const velocity = new THREE.Vector3(2.8, 0, 0.3)
    const result = createMoveResult()
    let worst = -Infinity
    for (let t = 0; t < 6; t += 1 / fps) {
      moveAndSlide(world, p, velocity.clone().multiplyScalar(1 / fps), result)
      worst = Math.max(worst, penetration(world, p))
    }
    assert.ok(worst <= 1e-9, `${fps}fps 최대 침투 ${worst}`)
  }
})
