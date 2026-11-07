// 본부실 걷기 지도 — 로비 서버 NPC 가 가구를 뚫지 않게(검토 22회차). 가상 인원 스크립트(scripts/preview-bots.mjs)의 길찾기를
// 그대로 옮겼다: 게임에서 뽑은 충돌 박스(generated/hq-obstacles.json, scripts/dump-hq-obstacles.mjs 가 만든다)를 사람
// 반지름만큼 부풀린 0.25 유닛 격자에서 A*(8방향, 모서리 가로지르기 없음)로 찾고, 보이는 데까지 직선으로 편다.
import mapJson from "../generated/hq-obstacles.json" with { type: "json" };

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
interface HqMapFile {
  hq: Box;
  wallMolding: number;
  obstacles: readonly Box[];
}

const MAP = mapJson as HqMapFile;
/** 사람 반지름(PLAYER_RADIUS 0.6) + 여유 */
const RADIUS = 0.6 + 0.15;
const WALL = MAP.wallMolding + RADIUS;
const CELL = 0.25;
const { hq } = MAP;
const NX = Math.round((hq.maxX - hq.minX) / CELL);
const NZ = Math.round((hq.maxZ - hq.minZ) / CELL);

/** 다른 사람 자리와 그 사람에게 둘 간격: [x, z, gap] */
export type Person = readonly [number, number, number];

export function isFree(x: number, z: number): boolean {
  if (x < hq.minX + WALL || x > hq.maxX - WALL || z < hq.minZ + WALL || z > hq.maxZ - WALL) return false;
  for (const o of MAP.obstacles) {
    if (x > o.minX - RADIUS && x < o.maxX + RADIUS && z > o.minZ - RADIUS && z < o.maxZ + RADIUS) return false;
  }
  return true;
}

export const cellX = (i: number) => hq.minX + (i + 0.5) * CELL;
export const cellZ = (j: number) => hq.minZ + (j + 0.5) * CELL;
export const cellIndex = (x: number, z: number) => {
  const i = Math.max(0, Math.min(NX - 1, Math.floor((x - hq.minX) / CELL)));
  const j = Math.max(0, Math.min(NZ - 1, Math.floor((z - hq.minZ) / CELL)));
  return i * NZ + j;
};
export const cellCenter = (k: number): [number, number] => [cellX(Math.floor(k / NZ)), cellZ(k % NZ)];

const open = new Uint8Array(NX * NZ);
for (let i = 0; i < NX; i += 1) for (let j = 0; j < NZ; j += 1) open[i * NZ + j] = isFree(cellX(i), cellZ(j)) ? 1 : 0;

/** 가장 큰 연결 영역의 빈칸 — 구석에 갇힌 빈칸에서 시작하거나 그리로 가지 않게 */
export const REACHABLE: readonly number[] = (() => {
  const free: number[] = [];
  for (let k = 0; k < open.length; k += 1) if (open[k]) free.push(k);
  const seen = new Int32Array(open.length).fill(-1);
  let best = { id: -1, size: 0 };
  let id = 0;
  for (const start of free) {
    if (seen[start]! >= 0) continue;
    const stack = [start];
    seen[start] = id;
    let size = 0;
    while (stack.length) {
      const k = stack.pop()!;
      size += 1;
      const i = Math.floor(k / NZ);
      const j = k % NZ;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
        const nk = ni * NZ + nj;
        if (open[nk] && seen[nk]! < 0) {
          seen[nk] = id;
          stack.push(nk);
        }
      }
    }
    if (size > best.size) best = { id, size };
    id += 1;
  }
  return free.filter((k) => seen[k] === best.id);
})();

/** 다른 사람과의 여유(거리 − 그 사람에게 둘 간격) 중 가장 작은 값. 음수면 너무 가깝다 */
export const clearance = (x: number, z: number, others: readonly Person[]) =>
  others.reduce((best, [ox, oz, gap]) => Math.min(best, Math.hypot(x - ox, z - oz) - gap), Infinity);
export const nearPerson = (x: number, z: number, others: readonly Person[], extra = 0) =>
  clearance(x, z, others) < extra;

/** 선분이 사람 반지름만큼 부풀린 장애물 상자의 안쪽(경계는 빈칸)을 지나는가 — Liang–Barsky 로 정확히 잰다 */
function segmentHitsBox(ax: number, az: number, bx: number, bz: number, o: Box): boolean {
  // isFree 는 경계를 빈칸으로 본다 — 아주 조금 줄여 같은 기준으로
  const minX = o.minX - RADIUS + 1e-6;
  const maxX = o.maxX + RADIUS - 1e-6;
  const minZ = o.minZ - RADIUS + 1e-6;
  const maxZ = o.maxZ + RADIUS - 1e-6;
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  // p · t ≤ q 꼴의 네 조건으로 선분을 상자 안으로 자른다
  for (const [p, q] of [
    [-dx, ax - minX],
    [dx, maxX - ax],
    [-dz, az - minZ],
    [dz, maxZ - az],
  ] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
  }
  return t1 > t0;
}

/**
 * 직선으로 갈 수 있나. 가구는 선분 × 부풀린 상자로 정확히 본다 — 0.1 간격 표본은 모서리를 스치는 짧은 겹침을 놓쳐
 * NPC 가 막힌 자리로 들어갔다(Codex 리뷰 3de4d97). 벽(방 경계)은 볼록한 사각형이라 끝점만 보면 된다(시작점은 지금 선 빈칸).
 * 사람은 움직이니 표본으로 본다.
 */
function lineIsFree(ax: number, az: number, bx: number, bz: number, avoid: readonly Person[]) {
  if (!isFree(bx, bz)) return false;
  for (const o of MAP.obstacles) if (segmentHitsBox(ax, az, bx, bz, o)) return false;
  if (!avoid.length) return true;
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1);
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    if (nearPerson(ax + (bx - ax) * t, az + (bz - az) * t, avoid, 0.2)) return false;
  }
  return true;
}

/** fromX, fromZ → 칸 goal 까지 길(꺾이는 점들). 없으면 null. avoid: 이번에 피해 갈 사람 자리 */
export function findPath(
  fromX: number,
  fromZ: number,
  goal: number,
  avoid: readonly Person[] = [],
): Array<[number, number]> | null {
  const start = cellIndex(fromX, fromZ);
  const gi = Math.floor(goal / NZ);
  const gj = goal % NZ;
  const h = (k: number) => {
    const dx = Math.abs(Math.floor(k / NZ) - gi);
    const dz = Math.abs((k % NZ) - gj);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };
  const g = new Float64Array(open.length).fill(Infinity);
  const came = new Int32Array(open.length).fill(-1);
  const closed = new Uint8Array(open.length);
  const heap: Array<[number, number]> = [[h(start), start]];
  g[start] = 0;
  while (heap.length) {
    // 작은 격자라 단순 최솟값 찾기로 충분하다
    let best = 0;
    for (let n = 1; n < heap.length; n += 1) if (heap[n]![0] < heap[best]![0]) best = n;
    const [, k] = heap.splice(best, 1)[0]!;
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = Math.floor(k / NZ);
    const j = k % NZ;
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
        const nk = ni * NZ + nj;
        if (!open[nk] || closed[nk]) continue;
        if (di && dj && (!open[i * NZ + nj] || !open[ni * NZ + j])) continue;
        if (avoid.length && nearPerson(cellX(ni), cellZ(nj), avoid, 0.2)) continue;
        const cost = g[k]! + (di && dj ? 1.414 : 1);
        if (cost < g[nk]!) {
          g[nk] = cost;
          came[nk] = k;
          heap.push([cost + h(nk), nk]);
        }
      }
    }
  }
  if (came[goal]! < 0 && goal !== start) return null;
  const cells: number[] = [];
  for (let k = goal; k >= 0 && k !== start; k = came[k]!) cells.unshift(k);
  const points = cells.map(cellCenter);
  const smooth: Array<[number, number]> = [];
  let cx = fromX;
  let cz = fromZ;
  let n = 0;
  while (n < points.length) {
    let far = n;
    for (let m = points.length - 1; m > n; m -= 1) {
      if (lineIsFree(cx, cz, points[m]![0], points[m]![1], avoid)) {
        far = m;
        break;
      }
    }
    smooth.push(points[far]!);
    [cx, cz] = points[far]!;
    n = far + 1;
  }
  return smooth;
}
