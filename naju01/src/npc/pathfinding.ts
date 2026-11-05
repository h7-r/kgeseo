import * as THREE from "three";
import { blocksAtHeight, isPointClear, isSegmentClear } from "./collision";
import type { CollisionWorld } from "./collision";
import type { CircleXZ } from "./avoidance";
import { npcProfile } from "./npcProfiler";
import { isTerrainSegmentWalkable } from "./terrain";
import type { NpcTerrain } from "./terrain";

// 장애물 외곽 경유점 + 가시성 그래프 기반의 가벼운 XZ 경로 탐색.
// 상자는 네 꼭짓점, 원기둥은 둘레 여덟 점을 경유점으로 쓴다. 지형(terrain)이 주어지면
// 모든 직선 구간이 걸을 수 있는 땅인지도 함께 확인한다(강·절벽·높은 턱을 가로지르지 않음).
// 장애물 수가 적은 범위(호출 측이 근처만 넘김)를 전제로 매 프레임 그래프를 새로 만든다.

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
  // 원기둥 둘레에 놓는 경유점 수. 정팔각형이면 꼭짓점 사이 직선이 원을 스치지 않게 반경을 키운다.
  circleNodeCount: 8,
  // 경유점 후보는 「현재 위치 → 후보 → 목표」 거리가 직선 거리 + 이 값 이하인 타원 안에서만 고른다 (m).
  // 그 밖의 후보로 도는 길은 직선보다 이만큼 이상 길어 동행 우회로로 쓸 일이 없다.
  // 장애물 자체(충돌 판정)는 그대로 두고 후보만 줄인다 — 실제 나주 소품 위에서 우회 한 번에
  // 지형 표본 13만 회 · 300 ms 가 들던 것을 줄이려고 넣었다. 10/20 하네스(실제 지형·소품 1623개)에서
  // 6 m → 걸음 최대 12 ms, 3 m → 7 ms 였고 3 m 로도 추적·대기 결과는 같았다. 동행 우회는 바위 하나를
  // 도는 정도라 직선보다 3 m 이상 긴 길이 필요하면 대기(blocked)로 둔다.
  searchMargin: 3,
  // 우회 중에는 이 간격(s)마다만 경유점 그래프를 다시 푼다. 그 사이에는 지난 경로를 따라가되,
  // 다음 지점이 직선으로 안 보이게 되면 바로 다시 푼다. (10/20 측정: 우회 프레임 한 번에 평균 7 ms)
  replanInterval: 0.1,
  // 목표가 이보다 멀고 직선으로 못 가면 그래프를 풀지 않고 대기(blocked)한다 (m).
  // 충돌 세계는 NPC 둘레 obstacleRange(10 m)만 담아 그보다 먼 계획은 믿을 수 없고, 플레이어가 멀리
  // 순간 이동한 뒤 맵을 가로지르는 탐색은 한 번에 300 ms 가까이 들었다(10/20 측정).
  maxSearchDistance: 12,
  // 한 프레임에 경유점 그래프를 푸는 최대 횟수. 추적 경로와 동행 후보 검사가 이 예산 하나를 나눠 쓴다.
  // 10/20 측정: 우회 부하에서 한 프레임에 추적 1 + 후보 검사 2 = 3번을 풀어 20–26 ms 가 들었다.
  // 예산을 넘긴 추적은 지난 경로를 따라가거나 한 프레임 제자리에 있고, 다음 프레임에 먼저 푼다(graphBudget).
  graphSolvesPerFrame: 1,
} as const;

// 프레임 예산. 컨트롤러가 프레임마다 beginGraphFrame 으로 채운다. 채우지 않으면(시험·다른 호출 측) 제한이 없다.
// followStarved: 추적이 예산을 못 받은 「바로 다음 한 프레임」에는 후보 검사가 예산을 쓰지 않는다 — 추적이 굶지 않게.
//   한 프레임만 유효하다: 그 사이 NPC 가 대기로 바뀌어 추적이 더 묻지 않아도 후보 검사가 영영 막히지 않는다.
export const graphBudget = { remaining: Infinity, followStarved: false, starvedThisFrame: false };

export function beginGraphFrame(perFrame: number = PATH_CONFIG.graphSolvesPerFrame): void {
  graphBudget.remaining = perFrame;
  graphBudget.followStarved = graphBudget.starvedThisFrame;
  graphBudget.starvedThisFrame = false;
}

/** planPath 를 부르는 쪽. 추적 경로(follow)가 동행 후보 검사(probe)보다 예산을 먼저 받는다 */
export type PathRole = "follow" | "probe";

function takeGraphBudget(role: PathRole): boolean {
  if (graphBudget.remaining <= 0) return false;
  if (role === "probe" && graphBudget.followStarved) return false;
  graphBudget.remaining--;
  if (role === "follow") graphBudget.followStarved = false;
  return true;
}

// direct = 직선으로 갈 수 있음, detour = 경유점으로 우회 중, blocked = 경로 없음(제자리 대기)
export type PathStatus = "direct" | "detour" | "blocked";

const GOAL_KEY = "goal";

export interface PathState {
  status: PathStatus;
  // 지금 향하고 있는 경유점의 고유 키 (장애물 id:꼭짓점 번호, 또는 'goal'). 안정화에 쓴다.
  committedKey: string | null;
  nextWaypoint: THREE.Vector3; // 이번 프레임에 향할 지점
  remaining: number; // 목표까지 남은 경로 길이 (m)
  graceRemaining: number; // 경유점 유지 유예 남은 시간 (s)
  // 남은 경로 지점들 (출발점 제외, 목표 포함). 마지막 지점은 호출 측의 goal 객체 그대로라 늘 최신이다.
  // 우회 중 재계산을 쉬는 동안(replanTimer) 이 목록을 따라간다.
  points: THREE.Vector3[];
  replanTimer: number; // 다음 우회 재계산까지 남은 시간 (s). 0 이면 이번 프레임에 다시 계산한다
  // 이 경로를 만든 충돌 세계 판 번호(CollisionWorld.revision). 판이 바뀌면(차단물 치움·월드 교체) 지난 경로를 버린다
  revision: number | null;
  // 이번 프레임에 그래프를 풀어야 했는데 예산이 없어 미뤘는가. 추적이면 지난 경로를 따라가거나 제자리,
  // 후보 검사면 결과를 모른다는 뜻이다(호출 측이 판단). 다음 프레임에 다시 푼다.
  deferred: boolean;
}

export function createPathState(): PathState {
  return {
    status: "direct",
    committedKey: null,
    nextWaypoint: new THREE.Vector3(),
    remaining: 0,
    graceRemaining: PATH_CONFIG.circleGraceTime,
    points: [],
    replanTimer: 0,
    revision: null,
    deferred: false,
  };
}

export function resetPath(path: PathState): void {
  path.status = "direct";
  path.committedKey = null;
  path.graceRemaining = PATH_CONFIG.circleGraceTime;
  path.points.length = 0;
  path.replanTimer = 0;
  path.revision = null;
  path.deferred = false;
}

interface PathNode {
  key: string;
  position: THREE.Vector3;
  // 원(플레이어 이격 범위) 안이지만 유예 중이라 남겨 둔 경유점
  graced: boolean;
}

// 높이 y에서 막는 장애물마다, 충돌 반경 + 여유만큼 바깥으로 뺀 네 꼭짓점을 경유점으로 만든다.
// 다른 장애물과 겹치는 경유점은 버린다. from·goal 둘레 탐색 타원(searchMargin) 밖의 후보도 버린다.
function buildNodes(
  world: CollisionWorld,
  y: number,
  circles: readonly CircleXZ[],
  graceKey: string | null,
  terrain: NpcTerrain | null,
  from: THREE.Vector3,
  goal: THREE.Vector3,
): PathNode[] {
  const offset = world.radius + PATH_CONFIG.cornerClearance;
  const nodes: PathNode[] = [];
  const bound = distanceXZ(from, goal) + PATH_CONFIG.searchMargin;
  const tryAdd = (key: string, x: number, z: number) => {
    // 가장 싼 거리 검사부터 — 타원 밖이면 충돌·지형 검사를 하지 않는다
    if (Math.hypot(x - from.x, z - from.z) + Math.hypot(x - goal.x, z - goal.z) > bound) return;
    const inCircle = circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius);
    const graced = inCircle && key === graceKey;
    if (!inCircle || graced) {
      if (!isPointClear(world, x, z, y)) return;
      if (terrain && !terrain.sample(x, z).walkable) return;
      nodes.push({ key, position: new THREE.Vector3(x, y, z), graced });
    }
  };
  for (const box of world.boxes) {
    if (!blocksAtHeight(box, y, world.radius)) continue;
    tryAdd(`${box.id}:0`, box.minX - offset, box.minZ - offset);
    tryAdd(`${box.id}:1`, box.maxX + offset, box.minZ - offset);
    tryAdd(`${box.id}:2`, box.maxX + offset, box.maxZ + offset);
    tryAdd(`${box.id}:3`, box.minX - offset, box.maxZ + offset);
  }
  const count = PATH_CONFIG.circleNodeCount;
  const apothemToRadius = 1 / Math.cos(Math.PI / count);
  for (const c of world.circles) {
    if (!blocksAtHeight(c, y, world.radius)) continue;
    const ring = (c.radius + offset) * apothemToRadius;
    for (let k = 0; k < count; k++) {
      const angle = (k / count) * Math.PI * 2;
      tryAdd(`${c.id}:c${k}`, c.x + Math.cos(angle) * ring, c.z + Math.sin(angle) * ring);
    }
  }
  for (const w of world.waypoints ?? []) tryAdd(`wp:${w.id}`, w.x, w.z);
  return nodes;
}

// 장애물에 닿지 않고, 지형이 있으면 그 직선이 걸을 수 있는 땅이어야 한다.
// fromNpc: NPC 현재 위치에서 나가는 구간이면, 못 걷는 땅 위에서 빠져나가는 것은 허용한다.
function segmentPassable(
  world: CollisionWorld,
  a: THREE.Vector3,
  b: THREE.Vector3,
  y: number,
  terrain: NpcTerrain | null,
  fromNpc = false,
): boolean {
  if (!isSegmentClear(world, a, b, y)) return false;
  return !terrain || isTerrainSegmentWalkable(terrain, a.x, a.z, b.x, b.z, fromNpc);
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function insideCircle(p: THREE.Vector3, c: CircleXZ): boolean {
  return Math.hypot(p.x - c.x, p.z - c.z) < c.radius;
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
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  for (const c of circles) {
    if ((exemptA && insideCircle(a, c)) || (exemptB && insideCircle(b, c))) continue;
    let t = lengthSq > 1e-12 ? ((c.x - a.x) * dx + (c.z - a.z) * dz) / lengthSq : 0;
    t = Math.min(1, Math.max(0, t));
    if (Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z) < c.radius - 1e-4) return false;
  }
  return true;
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
  terrain: NpcTerrain | null,
): boolean {
  return clearOfCircles(a, b, circles, exemptA, exemptB) && segmentPassable(world, a, b, y, terrain);
}

// 목표에서 거꾸로 Dijkstra: 각 경유점에서 목표까지 최단 거리와 다음 지점(-1 = 목표)
function solveToGoal(
  world: CollisionWorld,
  nodes: PathNode[],
  goal: THREE.Vector3,
  y: number,
  circles: readonly CircleXZ[],
  terrain: NpcTerrain | null,
): { cost: number[]; next: number[] } {
  const count = nodes.length;
  const cost = new Array<number>(count).fill(Infinity);
  const next = new Array<number>(count).fill(-1);
  const done = new Array<boolean>(count).fill(false);

  for (let i = 0; i < count; i++) {
    // 목표로 들어가는 마지막 구간은 원(플레이어 이격 범위)으로 막지 않는다.
    // 목표는 플레이어 바로 옆이라 이 구간이 원을 스치기 쉽고, 막으면 반대편 먼 우회로로
    // 바뀌었다 돌아오는 흔들림이 생긴다. 플레이어 주변을 도는 처리는 avoidance가 맡는다.
    if (linkClear(world, nodes[i].position, goal, y, [], nodes[i].graced, true, terrain)) {
      cost[i] = distanceXZ(nodes[i].position, goal);
    }
  }

  for (let round = 0; round < count; round++) {
    let u = -1;
    for (let i = 0; i < count; i++) {
      if (!done[i] && Number.isFinite(cost[i]) && (u < 0 || cost[i] < cost[u])) u = i;
    }
    if (u < 0) break;
    done[u] = true;
    for (let v = 0; v < count; v++) {
      if (done[v]) continue;
      const candidate = cost[u] + distanceXZ(nodes[u].position, nodes[v].position);
      if (
        candidate < cost[v] &&
        linkClear(world, nodes[u].position, nodes[v].position, y, circles, nodes[u].graced, nodes[v].graced, terrain)
      ) {
        cost[v] = candidate;
        next[v] = u;
      }
    }
  }
  return { cost, next };
}

interface Candidate {
  key: string;
  index: number; // -1 = 목표
  cost: number;
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
  terrain: NpcTerrain | null = null,
  role: PathRole = "follow",
): PathState {
  const y = from.y;
  if (npcProfile.enabled) npcProfile.counters.pathPlans++;
  path.deferred = false;
  // 충돌 세계 판이 바뀌었으면(차단물을 치웠거나 월드를 새로 만듦) 지난 우회 경로를 믿지 않는다
  const revision = world.revision ?? null;
  const sameWorld = path.revision === revision;

  if (segmentPassable(world, from, goal, y, terrain, true)) {
    path.status = "direct";
    path.committedKey = null;
    path.nextWaypoint.copy(goal);
    path.remaining = distanceXZ(from, goal);
    path.points.length = 0;
    path.points.push(goal);
    path.replanTimer = 0;
    path.revision = revision;
    return path;
  }

  if (distanceXZ(from, goal) > PATH_CONFIG.maxSearchDistance) {
    markBlocked(path, from);
    path.revision = revision;
    return path;
  }

  const hasPrevious = sameWorld && path.status === "detour";
  if (hasPrevious && path.replanTimer > 0 && followPreviousPath(world, from, path, y, terrain, delta)) {
    return path;
  }

  if (!takeGraphBudget(role)) {
    // 이번 프레임 예산이 없다 — 다음 프레임에 다시 푼다(replanTimer 0). 지금은 영구히 멈추지 않도록:
    // 추적은 지난 경로가 아직 보이면 그대로 따라가고, 없으면 이번 프레임만 제자리(blocked)다.
    path.deferred = true;
    path.replanTimer = 0;
    if (npcProfile.enabled) {
      if (role === "follow") npcProfile.counters.deferredFollow++;
      else npcProfile.counters.deferredProbes++;
    }
    if (role === "follow") {
      graphBudget.starvedThisFrame = true;
      if (hasPrevious && followPreviousPath(world, from, path, y, terrain, delta)) {
        path.replanTimer = 0;
        return path;
      }
      markBlocked(path, from);
      path.deferred = true;
      path.revision = revision;
    }
    return path;
  }

  path.revision = revision;
  if (!npcProfile.enabled) return planByGraph(world, from, goal, path, avoidCircles, delta, terrain, y);
  const graphStart = performance.now();
  planByGraph(world, from, goal, path, avoidCircles, delta, terrain, y);
  npcProfile.counters.graphSolves++;
  npcProfile.counters.graphMs += performance.now() - graphStart;
  return path;
}

// 경유점 그래프를 풀어 다음 지점을 정한다 (planPath 의 직선·재계산 쉼·원거리 대기가 아닌 경우)
function planByGraph(
  world: CollisionWorld,
  from: THREE.Vector3,
  goal: THREE.Vector3,
  path: PathState,
  avoidCircles: readonly CircleXZ[],
  delta: number,
  terrain: NpcTerrain | null,
  y: number,
): PathState {
  const graceKey = path.graceRemaining > 0 ? path.committedKey : null;
  const nodes = buildNodes(world, y, avoidCircles, graceKey, terrain, from, goal);
  // 따라가던 경유점이 원에 덮여 있으면 유예 시간을 줄이고, 아니면 다시 채운다
  if (nodes.some((n) => n.graced)) path.graceRemaining -= delta;
  else path.graceRemaining = PATH_CONFIG.circleGraceTime;
  const { cost, next } = solveToGoal(world, nodes, goal, y, avoidCircles, terrain);

  const candidates: Candidate[] = [];
  const addCandidate = (index: number, viaCost: number) => {
    const key = index < 0 ? GOAL_KEY : nodes[index].key;
    const existing = candidates.find((c) => c.key === key);
    if (!existing) candidates.push({ key, index, cost: viaCost });
    else if (viaCost < existing.cost) existing.cost = viaCost;
  };

  for (let i = 0; i < nodes.length; i++) {
    if (!Number.isFinite(cost[i])) continue;
    const d = distanceXZ(from, nodes[i].position);
    if (d < PATH_CONFIG.reachRadius) {
      // 이미 도착한 경유점: 그 다음 지점을 후보로 (경유점 위에 있으므로 보인다고 본다)
      const after = next[i];
      const afterPosition = after < 0 ? goal : nodes[after].position;
      addCandidate(after, distanceXZ(from, afterPosition) + (after < 0 ? 0 : cost[after]));
    } else if (segmentPassable(world, from, nodes[i].position, y, terrain, true)) {
      addCandidate(i, d + cost[i]);
    }
  }

  if (candidates.length === 0) {
    markBlocked(path, from);
    return path;
  }

  let chosen = candidates.reduce((a, b) => (b.cost < a.cost ? b : a));
  const committed = candidates.find((c) => c.key === path.committedKey);
  if (committed && committed.cost <= chosen.cost * PATH_CONFIG.switchRatio + PATH_CONFIG.switchMargin) {
    chosen = committed;
  }

  path.status = "detour";
  path.committedKey = chosen.key;
  path.remaining = chosen.cost;
  path.points.length = 0;
  for (let i = chosen.index; i >= 0; i = next[i]) path.points.push(nodes[i].position);
  path.points.push(goal);
  path.nextWaypoint.copy(chosen.index < 0 ? goal : nodes[chosen.index].position);
  path.replanTimer = PATH_CONFIG.replanInterval;
  return path;
}

function markBlocked(path: PathState, from: THREE.Vector3): void {
  path.status = "blocked";
  path.committedKey = null;
  path.nextWaypoint.copy(from);
  path.remaining = Infinity;
  path.points.length = 0;
  path.replanTimer = 0;
}

// 재계산을 쉬는 동안 지난 경로를 따라간다. 도착한 경유점은 빼고, 다음 지점이 직선으로 보이면 그리로 향한다.
// 다음 지점이 막혔으면 false — 호출 측이 바로 다시 푼다. 마지막 지점(goal)은 호출 측 객체라 늘 최신이다.
function followPreviousPath(
  world: CollisionWorld,
  from: THREE.Vector3,
  path: PathState,
  y: number,
  terrain: NpcTerrain | null,
  delta: number,
): boolean {
  while (path.points.length > 1 && distanceXZ(from, path.points[0]) < PATH_CONFIG.reachRadius) path.points.shift();
  const next = path.points[0];
  if (!next || !segmentPassable(world, from, next, y, terrain, true)) return false;
  path.replanTimer -= delta;
  path.nextWaypoint.copy(next);
  let remaining = distanceXZ(from, next);
  for (let i = 1; i < path.points.length; i++) remaining += distanceXZ(path.points[i - 1], path.points[i]);
  path.remaining = remaining;
  return true;
}
