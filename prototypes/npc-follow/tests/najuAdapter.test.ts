// [Stage 0 신규] 좌표 단위 변환 및 mock 나주 맵 어댑터
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createNajuNpcWorld } from '../src/npc/naju/najuNpcAdapter.ts'
import {
  createMockAvatarLink,
  createMockNajuMap,
  isFlatTestArea,
  MOCK_CORE_BOUNDS,
  MOCK_EYE_HEIGHT,
  placeMockPlayer,
} from '../src/npc/naju/mockNajuMap.ts'
import { metersToUnits, unitsToMeters, UNITS_PER_METER } from '../src/npc/units.ts'
import type { FollowTargetPose } from '../src/npc/followLogic.ts'

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

function setup(options: { restricted?: boolean } = {}) {
  const map = createMockNajuMap()
  const link = createMockAvatarLink(20, 37)
  const world = createNajuNpcWorld({
    player: { current: link },
    terrain: map.terrain,
    props: map.props,
    coreBounds: MOCK_CORE_BOUNDS,
    isAllowed: options.restricted ? isFlatTestArea : null,
  })
  return { map, link, world }
}

test('단위 변환: 미터 ↔ 유닛 왕복', () => {
  for (const m of [0, 1, 1.6, 14, 79.5]) assert.ok(close(unitsToMeters(metersToUnits(m)), m))
  assert.ok(close(metersToUnits(0.3), 1))
})

test('플레이어 자세: 유닛·눈높이로 적힌 상자를 미터·발 높이로 읽는다', () => {
  const { link, world } = setup()
  // 상자에는 유닛 값과 눈높이가 들어 있다
  assert.ok(close(link.position.x, 20 * UNITS_PER_METER))
  assert.ok(close(link.position.y, MOCK_EYE_HEIGHT * UNITS_PER_METER))
  const pose: FollowTargetPose = { position: new THREE.Vector3(), yaw: 0 }
  world.readPlayer(pose)
  assert.ok(close(pose.position.x, 20) && close(pose.position.z, 37))
  assert.ok(close(pose.position.y, 0), '발 높이(지면)')
  assert.equal(pose.yaw, link.facing)

  placeMockPlayer(link, 45, 15) // Z3 고도 14
  world.readPlayer(pose)
  assert.ok(close(pose.position.y, 14))
})

test('플레이어 상자가 아직 없으면 null', () => {
  const map = createMockNajuMap()
  const world = createNajuNpcWorld({ player: { current: null }, terrain: map.terrain, coreBounds: MOCK_CORE_BOUNDS })
  assert.equal(world.readPlayer({ position: new THREE.Vector3(), yaw: 0 }), null)
})

test('지형 판정: 강·벼랑면·코어 밖·허용 구역 밖은 못 걷는다', () => {
  const { world } = setup({ restricted: true })
  assert.deepEqual(world.terrain.sample(20, 37), { y: 0, walkable: true, reason: null })
  assert.equal(world.terrain.sample(20, 46).reason, 'water')
  assert.equal(world.terrain.sample(40, 28).reason, 'fall')
  assert.equal(world.terrain.sample(-1, 30).reason, 'outside')
  assert.equal(world.terrain.sample(45, 15).reason, 'restricted') // Z3 — 1차 범위 밖
  assert.equal(world.terrain.sample(31, 38).walkable, true) // T1 통로
})

test('차단물: 높이 범위를 그대로 옮기고, 치운 차단물은 빠진다', () => {
  const { map, world } = setup()
  const before = world.collisionNear(20, 37)
  const b1 = before.boxes.find((b) => b.id === 'B1')
  assert.deepEqual(b1, { id: 'B1', minX: 28, maxX: 34, minZ: 30, maxZ: 34.6, minY: 0, maxY: 3.5 })
  assert.ok(before.boxes.some((b) => b.id === 'B9'))
  map.terrain.clearedBlockers.add('B9')
  assert.equal(world.collisionNear(20, 37).boxes.some((b) => b.id === 'B9'), false)
})

test('소품 원기둥: 범위 안의 것만, 서로 다른 id 로 옮긴다', () => {
  const { world } = setup()
  const near = world.collisionNear(14, 37)
  const ids = near.circles.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'id 가 겹치지 않는다')
  assert.ok(near.circles.some((c) => c.x === 14 && c.z === 36 && c.minY === 0 && c.maxY === 5))
  assert.equal(near.circles.some((c) => c.x === 52), false, '10 m 밖 소품은 뺀다')
})

test('미터 → 나주 월드 좌표(유닛)', () => {
  const { world } = setup()
  const out = world.toWorld({ x: 3, y: 1.5, z: 30 }, new THREE.Vector3())
  assert.ok(close(out.x, 10) && close(out.y, 5) && close(out.z, 100))
})
