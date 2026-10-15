import * as THREE from 'three'
import { blocksAtHeight, isPointClear, isSegmentClear } from './collision'
import type { CollisionWorld } from './collision'
import type { CircleXZ } from './avoidance'

// 장애물 외곽 꼭짓점 경유점 + 가시성 그래프 기반의 가벼운 XZ 경로 탐색.
// 장애물 수가 적은 테스트 맵용으로, 매 프레임 그래프를 새로 만들어도 부담이 작다.

export const PATH_CONFIG = {
  // 경유점을 충돌 반경 바깥으로 더 띄우는 여유 (m). 경유점 사이 직선이 장애물을 스치지 않게 한다.
  cornerClearance: 0.15,
  // 경유점에 이 거리 안으로 들어오면 지난 것으로 보고 다음 경유점으로 넘어간다 (m)
  reachRadius: 0.3,
  // 지금 따라가는 경로를 버리려면 새 경로가 이 비율·여유 이상 짧아야 한다 (좌우 반복 전환 방지)
  switchRatio: 1.15,
  switchMargin: 0.3,
  // 따라가던 경유점이 플레이어 이격 범위에 덮여도 이 시간 동안은 버리지 않는다 (s).
  // 플레이어가 꼭짓점 옆을 지나갈 때 먼 우회로로 잠깐 바뀌었다 돌아오는 흔들림을 막고,
  // 플레이어가 그 자리에 계속 서 있으면 시간이 지난 뒤 다른 경로로 바꾼다.
  circleGraceTime: 1.0,
} as const

// direct = 직선으로 갈 수 있음, detour = 경유점으로 우회 중, blocked = 경로 없음(제자리 대기)
export type PathStatus = 'direct' | 'detour' | 'blocked'

const GOAL_KEY = 'goal'

export interface PathState {
  status: PathStatus
  // 지금 향하고 있는 경유점의 고유 키 (장애물 id:꼭짓점 번호, 또는 'goal'). 안정화에 쓴다.
  committedKey: string | null
  nextWaypoint: THREE.Vector3 // 이번 프레임에 향할 지점
  remaining: number // 목표까지 남은 경로 길이 (m)
  graceRemaining: number // 경유점 유지 유예 남은 시간 (s)
  points: THREE.Vector3[] // 관찰용: 남은 경로 지점들 (출발점 제외, 목표 포함)
}

export function createPathState(): PathState {
  return {
    status: 'direct',
    committedKey: null,
    nextWaypoint: new THREE.Vector3(),
    remaining: 0,
    graceRemaining: PATH_CONFIG.circleGraceTime,
    points: [],
  }
}

export function resetPath(path: PathState): void {
  path.status = 'direct'
  path.committedKey = null
  path.graceRemaining = PATH_CONFIG.circleGraceTime
  path.points.length = 0
}

interface PathNode {
  key: string
  position: THREE.Vector3
  // 원(플레이어 이격 범위) 안이지만 유예 중이라 남겨 둔 경유점
  graced: boolean
}

// 높이 y에서 막는 장애물마다, 충돌 반경 + 여유만큼 바깥으로 뺀 네 꼭짓점을 경유점으로 만든다.
// 다른 장애물과 겹치는 경유점은 버린다.
function buildNodes(
  world: CollisionWorld,
  y: number,
  circles: readonly CircleXZ[],
  graceKey: string | null,
): PathNode[] {
  const offset = world.radius + PATH_CONFIG.cornerClearance
  const nodes: PathNode[] = []
  for (const box of world.boxes) {
    if (!blocksAtHeight(box, y, world.radius)) continue
    const corners: [number, number][] = [
      [box.minX - offset, box.minZ - offset],
      [box.maxX + offset, box.minZ - offset],
      [box.maxX + offset, box.maxZ + offset],
      [box.minX - offset, box.maxZ + offset],
    ]
    corners.forEach(([x, z], index) => {
      const key = `${box.id}:${index}`
      const inCircle = circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius)
      const graced = inCircle && key === graceKey
      if ((!inCircle || graced) && isPointClear(world, x, z, y)) {
        nodes.push({ key, position: new THREE.Vector3(x, y, z), graced })
      }
    })
  }
  return nodes
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function insideCircle(p: THREE.Vector3, c: CircleXZ): boolean {
  return Math.hypot(p.x - c.x, p.z - c.z) < c.radius
}

// 선분 a→b가 원(플레이어 이격 범위 등)을 지나지 않는지.
// exemptA/B인 끝점이 원 안에 있으면 그 원으로는 막지 않는다 (목표, 유예 중인 경유점).
// 그렇지 않으면 그 점으로 가는 연결이 전부 끊겨 경로가 사라진다.
function clearOfCircles(
  a: THREE.Vector3,
  b: THREE.Vector3,
  circles: readonly CircleXZ[],
  exemptA: boolean,
  exemptB: boolean,
): boolean {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lengthSq = dx * dx + dz * dz
  for (const c of circles) {
    if ((exemptA && insideCircle(a, c)) || (exemptB && insideCircle(b, c))) continue
    let t = lengthSq > 1e-12 ? ((c.x - a.x) * dx + (c.z - a.z) * dz) / lengthSq : 0
    t = Math.min(1, Math.max(0, t))
    if (Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z) < c.radius - 1e-4) return false
  }
  return true
}

// 경유점 사이 연결: 장애물과 원을 모두 피해야 한다
function linkClear(
  world: CollisionWorld,
  a: THREE.Vector3,
  b: THREE.Vector3,
  y: number,
  circles: readonly CircleXZ[],
  exemptA: boolean,
  exemptB: boolean,
): boolean {
  return clearOfCircles(a, b, circles, exemptA, exemptB) && isSegmentClear(world, a, b, y)
}

// 목표에서 거꾸로 Dijkstra: 각 경유점에서 목표까지 최단 거리와 다음 지점(-1 = 목표)
function solveToGoal(
  world: CollisionWorld,
  nodes: PathNode[],
  goal: THREE.Vector3,
  y: number,
  circles: readonly CircleXZ[],
): { cost: number[]; next: number[] } {
  const count = nodes.length
  const cost = new Array<number>(count).fill(Infinity)
  const next = new Array<number>(count).fill(-1)
  const done = new Array<boolean>(count).fill(false)

  for (let i = 0; i < count; i++) {
    // 목표로 들어가는 마지막 구간은 원(플레이어 이격 범위)으로 막지 않는다.
    // 목표는 플레이어 바로 옆이라 이 구간이 원을 스치기 쉽고, 막으면 반대편 먼 우회로로
    // 바뀌었다 돌아오는 흔들림이 생긴다. 플레이어 주변을 도는 처리는 avoidance가 맡는다.
    if (linkClear(world, nodes[i].position, goal, y, [], nodes[i].graced, true)) {
      cost[i] = distanceXZ(nodes[i].position, goal)
    }
  }

  for (let round = 0; round < count; round++) {
    let u = -1
    for (let i = 0; i < count; i++) {
      if (!done[i] && Number.isFinite(cost[i]) && (u < 0 || cost[i] < cost[u])) u = i
    }
    if (u < 0) break
    done[u] = true
    for (let v = 0; v < count; v++) {
      if (done[v]) continue
      const candidate = cost[u] + distanceXZ(nodes[u].position, nodes[v].position)
      if (
        candidate < cost[v] &&
        linkClear(
          world,
          nodes[u].position,
          nodes[v].position,
          y,
          circles,
          nodes[u].graced,
          nodes[v].graced,
        )
      ) {
        cost[v] = candidate
        next[v] = u
      }
    }
  }
  return { cost, next }
}

interface Candidate {
  key: string
  index: number // -1 = 목표
  cost: number
}

// from에서 goal까지 다음에 향할 지점을 정해 path에 기록한다.
// - 직선이 열려 있으면 바로 목표로 간다.
// - 막혀 있으면 장애물 꼭짓점 경유점으로 최단 경로를 찾되, 지금 따라가는 경유점이
//   충분히 나쁘지 않으면 유지해 매 프레임 좌우로 뒤집히지 않게 한다.
// - 경로가 없으면 blocked: 현재 위치에서 대기한다.
// avoidCircles(예: 플레이어 이격 범위)는 경유점 위치와 경유점 사이 연결에만 적용한다.
// 현재 위치에서 다음 지점까지의 구간은 호출 측(플레이어 회피 우회)이 처리한다.
export function planPath(
  world: CollisionWorld,
  from: THREE.Vector3,
  goal: THREE.Vector3,
  path: PathState,
  avoidCircles: readonly CircleXZ[] = [],
  delta = 0,
): PathState {
  const y = from.y

  if (isSegmentClear(world, from, goal, y)) {
    path.status = 'direct'
    path.committedKey = null
    path.nextWaypoint.copy(goal)
    path.remaining = distanceXZ(from, goal)
    path.points.length = 0
    path.points.push(goal)
    return path
  }

  const graceKey = path.graceRemaining > 0 ? path.committedKey : null
  const nodes = buildNodes(world, y, avoidCircles, graceKey)
  // 따라가던 경유점이 원에 덮여 있으면 유예 시간을 줄이고, 아니면 다시 채운다
  if (nodes.some((n) => n.graced)) path.graceRemaining -= delta
  else path.graceRemaining = PATH_CONFIG.circleGraceTime
  const { cost, next } = solveToGoal(world, nodes, goal, y, avoidCircles)

  const candidates: Candidate[] = []
  const addCandidate = (index: number, viaCost: number) => {
    const key = index < 0 ? GOAL_KEY : nodes[index].key
    const existing = candidates.find((c) => c.key === key)
    if (!existing) candidates.push({ key, index, cost: viaCost })
    else if (viaCost < existing.cost) existing.cost = viaCost
  }

  for (let i = 0; i < nodes.length; i++) {
    if (!Number.isFinite(cost[i])) continue
    const d = distanceXZ(from, nodes[i].position)
    if (d < PATH_CONFIG.reachRadius) {
      // 이미 도착한 경유점: 그 다음 지점을 후보로 (경유점 위에 있으므로 보인다고 본다)
      const after = next[i]
      const afterPosition = after < 0 ? goal : nodes[after].position
      addCandidate(after, distanceXZ(from, afterPosition) + (after < 0 ? 0 : cost[after]))
    } else if (isSegmentClear(world, from, nodes[i].position, y)) {
      addCandidate(i, d + cost[i])
    }
  }

  if (candidates.length === 0) {
    path.status = 'blocked'
    path.committedKey = null
    path.nextWaypoint.copy(from)
    path.remaining = Infinity
    path.points.length = 0
    return path
  }

  let chosen = candidates.reduce((a, b) => (b.cost < a.cost ? b : a))
  const committed = candidates.find((c) => c.key === path.committedKey)
  if (
    committed &&
    committed.cost <= chosen.cost * PATH_CONFIG.switchRatio + PATH_CONFIG.switchMargin
  ) {
    chosen = committed
  }

  path.status = 'detour'
  path.committedKey = chosen.key
  path.remaining = chosen.cost
  path.points.length = 0
  for (let i = chosen.index; i >= 0; i = next[i]) path.points.push(nodes[i].position)
  path.points.push(goal)
  path.nextWaypoint.copy(chosen.index < 0 ? goal : nodes[chosen.index].position)
  return path
}
