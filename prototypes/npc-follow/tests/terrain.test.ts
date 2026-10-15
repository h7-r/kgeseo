// [Stage 0 신규] 지형 높이·이동 가능 영역 검증 (강·절벽·높은 턱)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groundHeight,
  guardTerrainMove,
  isTerrainSegmentWalkable,
  TERRAIN_CONFIG,
} from '../src/npc/terrain.ts'
import type { NpcTerrain, TerrainSample } from '../src/npc/terrain.ts'

// x < 5: 평지 · 5 ≤ x < 6: 강 · x ≥ 6: 평지 · z > 10: 높이 1.0 의 턱 · 2 ≤ z ≤ 4 (x<5): 0.4 낮은 계단
const fixture: NpcTerrain = {
  sample(x: number, z: number): TerrainSample {
    if (x >= 5 && x < 6) return { y: -0.5, walkable: false, reason: 'water' }
    if (z > 10) return { y: 1.0, walkable: true, reason: null }
    if (z >= 2 && z <= 4 && x < 5) return { y: 0.4, walkable: true, reason: null }
    return { y: 0, walkable: true, reason: null }
  },
}

test('평지 직선은 걸을 수 있다', () => {
  assert.equal(isTerrainSegmentWalkable(fixture, 0, 0, 4, 0), true)
})

test('강을 가로지르는 직선은 못 걷는다', () => {
  assert.equal(isTerrainSegmentWalkable(fixture, 0, 0, 8, 0), false)
})

test(`턱(${TERRAIN_CONFIG.maxStep} m 초과)을 오르는 직선은 못 걷고, 낮은 계단은 오른다`, () => {
  assert.equal(isTerrainSegmentWalkable(fixture, 0, 9, 0, 12), false)
  assert.equal(isTerrainSegmentWalkable(fixture, 0, 0, 0, 3), true)
})

test('강 앞에서 멈춘다: 이동이 막히면 경계 바로 앞까지만 간다', () => {
  const r = guardTerrainMove(fixture, 4.5, 0, 5.5, 0)
  assert.equal(r.blocked, true)
  assert.equal(r.reason, 'water')
  assert.ok(r.x < 5 && r.x >= 4.5, `x=${r.x}`)
  assert.equal(fixture.sample(r.x, r.z).walkable, true)
})

test('강을 비스듬히 향하면 강을 따라(축 방향으로) 미끄러진다', () => {
  const r = guardTerrainMove(fixture, 4.8, 0, 5.3, 1)
  assert.equal(r.blocked, true)
  assert.equal(r.blockedX, true)
  assert.equal(r.blockedZ, false)
  assert.equal(r.x, 4.8)
  assert.equal(r.z, 1)
})

test('높은 턱 앞에서 멈춘다', () => {
  const r = guardTerrainMove(fixture, 0, 9.9, 0, 10.5)
  assert.equal(r.blocked, true)
  assert.equal(r.reason, 'step')
  assert.ok(r.z <= 10)
})

test('이미 못 걷는 땅에 있으면(외부 요인) 빠져나가는 이동은 허용한다', () => {
  const r = guardTerrainMove(fixture, 5.5, 0, 4.0, 0)
  assert.equal(r.blocked, false)
  assert.equal(r.x, 4.0)
})

test('발밑 높이: 둘레에서 오를 수 있는 가장 높은 곳, 턱 너머는 무시', () => {
  assert.equal(groundHeight(fixture, 0, 1.9), 0.4) // 계단 가장자리 — 계단을 밟는다
  assert.equal(groundHeight(fixture, 0, 9.9), 0) // 1.0 턱은 오를 수 없어 무시
})
