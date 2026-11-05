import * as THREE from "three";

// 회전 없는 상자 장애물 정의 (m). center 는 상자 중심, size 는 [폭(X), 높이(Y), 깊이(Z)].
// 나주 맵의 도면 차단물은 어댑터가 CollisionBox 로 바로 만들므로, 이 형식은 시험·도구용이다.
export interface BoxObstacle {
  id: string;
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}

// NPC 구체의 충돌 반경 (m). 보이는 크기(npcTestConfig 의 NPC_TEST_VISUAL_RADIUS)와는 따로 둔다.
export const NPC_COLLISION_RADIUS = 0.35;

// 충돌면에서 띄워 두는 간격. 부동소수 오차로 면 안쪽에 끼지 않게 한다. (m)
const SKIN = 0.002;
// 한 번의 이동에서 면을 따라 미끄러지는 최대 횟수 (모서리·안쪽 구석 대응)
const MAX_SLIDES = 4;
const EPSILON = 1e-9;

// 수평(XZ) 단면과 높이 범위로 단순화한 충돌용 상자 (회전 없음)
export interface CollisionBox {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

// 수직 원기둥 장애물 (나무·바위·울타리 같은 소품). x·z 는 중심, minY~maxY 는 높이 범위 (m)
export interface CollisionCircle {
  id: string;
  x: number;
  z: number;
  radius: number;
  minY: number;
  maxY: number;
}

// 장애물이 아니라 지형 때문에 생기는 길목(통로 중심선 등)을 경로 탐색에 알려 주는 고정 경유점 (m)
export interface NavWaypoint {
  id: string;
  x: number;
  z: number;
}

export interface CollisionWorld {
  boxes: readonly CollisionBox[];
  circles: readonly CollisionCircle[];
  radius: number;
  // 강·절벽 사이 좁은 통로처럼 장애물 꼭짓점만으로는 찾을 수 없는 길을 잇는다 (선택)
  waypoints?: readonly NavWaypoint[];
  // 장애물 구성 판 번호 (선택). 차단물을 치우거나 월드를 새로 만들면 바뀐다 — 경로 탐색이 지난 경로·후보 검사 결과를 버린다
  revision?: number;
}

export function createCollisionWorld(
  obstacles: readonly BoxObstacle[],
  radius = NPC_COLLISION_RADIUS,
  circles: readonly CollisionCircle[] = [],
): CollisionWorld {
  return {
    radius,
    circles,
    boxes: obstacles.map(({ id, center, size }) => ({
      id,
      minX: center[0] - size[0] / 2,
      maxX: center[0] + size[0] / 2,
      minY: center[1] - size[1] / 2,
      maxY: center[1] + size[1] / 2,
      minZ: center[2] - size[2] / 2,
      maxZ: center[2] + size[2] / 2,
    })),
  };
}

export interface MoveResult {
  blocked: boolean; // 이동 중 장애물에 닿았는지
  // 마지막으로 닿은 면의 바깥 방향 법선 (XZ, 닿지 않았으면 0)
  normal: THREE.Vector3;
  hitId: string | null;
}

// 구체 높이 범위와 겹치는 장애물만 막는다. 거리 판정과 같은 추적 높이(부유 오프셋 제외)를 쓴다.
export function blocksAtHeight(shape: { minY: number; maxY: number }, y: number, radius: number): boolean {
  return y + radius > shape.minY && y - radius < shape.maxY;
}

interface Hit {
  t: number;
  nx: number;
  nz: number;
  id: string;
}

// 반직선 p + t·d (t∈[0,1])가 축 정렬 사각형에 처음 들어가는 지점
function sweepRect(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { t: number; nx: number; nz: number } | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let nx = 0;
  let nz = 0;

  if (Math.abs(dx) < EPSILON) {
    if (px <= minX || px >= maxX) return null;
  } else {
    const t1 = (minX - px) / dx;
    const t2 = (maxX - px) / dx;
    const near = Math.min(t1, t2);
    if (near > tEnter) {
      tEnter = near;
      nx = dx > 0 ? -1 : 1;
      nz = 0;
    }
    tExit = Math.min(tExit, Math.max(t1, t2));
  }

  if (Math.abs(dz) < EPSILON) {
    if (pz <= minZ || pz >= maxZ) return null;
  } else {
    const t1 = (minZ - pz) / dz;
    const t2 = (maxZ - pz) / dz;
    const near = Math.min(t1, t2);
    if (near > tEnter) {
      tEnter = near;
      nx = 0;
      nz = dz > 0 ? -1 : 1;
    }
    tExit = Math.min(tExit, Math.max(t1, t2));
  }

  // 이미 안쪽에서 출발한 경우(tEnter < 0)는 침투 해소(resolvePenetration)가 담당한다
  if (tEnter > tExit || tEnter < -1e-6 || tEnter > 1) return null;
  return { t: Math.max(0, tEnter), nx, nz };
}

// 반직선이 원(모서리를 둥글게 확장한 부분)에 처음 닿는 지점
function sweepCircle(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  cx: number,
  cz: number,
  r: number,
): { t: number; nx: number; nz: number } | null {
  const ox = px - cx;
  const oz = pz - cz;
  const a = dx * dx + dz * dz;
  if (a < EPSILON) return null;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - r * r;
  if (c < 0) return null; // 원 안에서 출발 → 침투 해소가 담당
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < -1e-6 || t > 1) return null;
  const hx = ox + dx * t;
  const hz = oz + dz * t;
  return { t: Math.max(0, t), nx: hx / r, nz: hz / r };
}

// 반경 r 원을 d만큼 이동시킬 때 처음 닿는 상자 면 (연속 충돌 검사).
// 상자를 r만큼 둥글게 확장한 도형(사각형 2개 + 모서리 원 4개)에 대한 반직선 검사와 같다.
function sweepCircleXZ(world: CollisionWorld, px: number, py: number, pz: number, dx: number, dz: number): Hit | null {
  // SKIN만큼 두껍게 검사해, 접촉 상태에서 면에 정확히 멈추고 더 파고들지 않게 한다.
  // (닿은 뒤 바깥으로 따로 밀어내면 프레임마다 미세하게 들어갔다 나오는 떨림이 생긴다)
  const r = world.radius + SKIN;
  let best: Hit | null = null;
  const consider = (h: { t: number; nx: number; nz: number } | null, id: string) => {
    // 면에서 멀어지는 방향의 이동은 막지 않는다
    if (h && h.nx * dx + h.nz * dz < 0 && (!best || h.t < best.t)) {
      best = { t: h.t, nx: h.nx, nz: h.nz, id };
    }
  };

  for (const box of world.boxes) {
    if (!blocksAtHeight(box, py, world.radius)) continue;
    consider(sweepRect(px, pz, dx, dz, box.minX - r, box.maxX + r, box.minZ, box.maxZ), box.id);
    consider(sweepRect(px, pz, dx, dz, box.minX, box.maxX, box.minZ - r, box.maxZ + r), box.id);
    consider(sweepCircle(px, pz, dx, dz, box.minX, box.minZ, r), box.id);
    consider(sweepCircle(px, pz, dx, dz, box.minX, box.maxZ, r), box.id);
    consider(sweepCircle(px, pz, dx, dz, box.maxX, box.minZ, r), box.id);
    consider(sweepCircle(px, pz, dx, dz, box.maxX, box.maxZ, r), box.id);
  }
  // 원기둥은 반경을 NPC 반경만큼 키운 원과의 반직선 검사와 같다
  for (const c of world.circles) {
    if (!blocksAtHeight(c, py, world.radius)) continue;
    consider(sweepCircle(px, pz, dx, dz, c.x, c.z, c.radius + r), c.id);
  }
  return best;
}

// 이미 장애물에 겹쳐 있으면 가장 가까운 바깥으로 밀어낸다 (스폰 위치, 외부 강제 이동 대비).
// 밀어냈으면 true.
export function resolvePenetration(world: CollisionWorld, position: THREE.Vector3): boolean {
  const r = world.radius;
  let moved = false;
  // 상자가 붙어 있는 경우를 위해 몇 번 반복
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const box of world.boxes) {
      if (!blocksAtHeight(box, position.y, r)) continue;
      const cx = Math.min(Math.max(position.x, box.minX), box.maxX);
      const cz = Math.min(Math.max(position.z, box.minZ), box.maxZ);
      const ox = position.x - cx;
      const oz = position.z - cz;
      const distSq = ox * ox + oz * oz;
      if (distSq >= r * r) continue;

      if (distSq > EPSILON) {
        const dist = Math.sqrt(distSq);
        position.x = cx + (ox / dist) * (r + SKIN);
        position.z = cz + (oz / dist) * (r + SKIN);
      } else {
        // 중심이 상자 안: 가장 가까운 면으로 빼낸다
        const exits = [
          { d: position.x - box.minX, x: box.minX - r - SKIN, z: position.z },
          { d: box.maxX - position.x, x: box.maxX + r + SKIN, z: position.z },
          { d: position.z - box.minZ, x: position.x, z: box.minZ - r - SKIN },
          { d: box.maxZ - position.z, x: position.x, z: box.maxZ + r + SKIN },
        ];
        const exit = exits.reduce((a, b) => (b.d < a.d ? b : a));
        position.x = exit.x;
        position.z = exit.z;
      }
      any = true;
      moved = true;
    }
    for (const c of world.circles) {
      if (!blocksAtHeight(c, position.y, r)) continue;
      const ox = position.x - c.x;
      const oz = position.z - c.z;
      const reach = c.radius + r;
      const distSq = ox * ox + oz * oz;
      if (distSq >= reach * reach) continue;
      const dist = Math.sqrt(distSq);
      // 중심이 정확히 겹치면 +X 쪽으로 뺀다 (방향을 정할 근거가 없음)
      const nx = dist > EPSILON ? ox / dist : 1;
      const nz = dist > EPSILON ? oz / dist : 0;
      position.x = c.x + nx * (reach + SKIN);
      position.z = c.z + nz * (reach + SKIN);
      any = true;
      moved = true;
    }
    if (!any) break;
  }
  return moved;
}

const remaining = new THREE.Vector3();

// position을 motion만큼(XZ) 옮기되 장애물을 관통하지 않고, 막히면 면을 따라 미끄러진다.
// y는 바꾸지 않는다. result.normal에는 마지막 접촉면 법선이 담긴다.
export function moveAndSlide(
  world: CollisionWorld,
  position: THREE.Vector3,
  motion: THREE.Vector3,
  result: MoveResult,
): MoveResult {
  result.blocked = false;
  result.normal.set(0, 0, 0);
  result.hitId = null;

  remaining.set(motion.x, 0, motion.z);
  for (let i = 0; i < MAX_SLIDES; i++) {
    if (remaining.lengthSq() < EPSILON) break;

    const hit = sweepCircleXZ(world, position.x, position.y, position.z, remaining.x, remaining.z);
    if (!hit) {
      position.x += remaining.x;
      position.z += remaining.z;
      break;
    }

    // 닿는 지점(면에서 SKIN만큼 떨어진 곳)까지만 이동한다
    position.x += remaining.x * hit.t;
    position.z += remaining.z * hit.t;
    result.blocked = true;
    result.normal.set(hit.nx, 0, hit.nz);
    result.hitId = hit.id;

    // 남은 이동량에서 면을 파고드는 성분을 제거해 면을 따라 미끄러진다
    remaining.multiplyScalar(1 - hit.t);
    const into = remaining.x * hit.nx + remaining.z * hit.nz;
    if (into < 0) {
      remaining.x -= into * hit.nx;
      remaining.z -= into * hit.nz;
    }
  }
  return result;
}

export function createMoveResult(): MoveResult {
  return { blocked: false, normal: new THREE.Vector3(), hitId: null };
}

// ---------- 경로 탐색용 조회 (위치를 바꾸지 않음) ----------

// 점과 사각형(XZ) 사이 거리. 안에 있으면 0.
function pointRectDistance(px: number, pz: number, box: CollisionBox): number {
  const dx = Math.max(box.minX - px, 0, px - box.maxX);
  const dz = Math.max(box.minZ - pz, 0, pz - box.maxZ);
  return Math.hypot(dx, dz);
}

function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  let t = lengthSq > EPSILON ? ((px - ax) * dx + (pz - az) * dz) / lengthSq : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// 선분이 사각형을 지나는지 (Liang–Barsky 클리핑)
function segmentCrossesRect(ax: number, az: number, bx: number, bz: number, box: CollisionBox): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < EPSILON) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - box.minX) && clip(dx, box.maxX - ax) && clip(-dz, az - box.minZ) && clip(dz, box.maxZ - az);
}

// 선분과 사각형 사이 최소 거리. 볼록 도형이므로 교차하지 않으면
// 선분 끝점–사각형, 사각형 꼭짓점–선분 거리 중 최솟값이다.
function segmentRectDistance(ax: number, az: number, bx: number, bz: number, box: CollisionBox): number {
  if (segmentCrossesRect(ax, az, bx, bz, box)) return 0;
  return Math.min(
    pointRectDistance(ax, az, box),
    pointRectDistance(bx, bz, box),
    pointSegmentDistance(box.minX, box.minZ, ax, az, bx, bz),
    pointSegmentDistance(box.minX, box.maxZ, ax, az, bx, bz),
    pointSegmentDistance(box.maxX, box.minZ, ax, az, bx, bz),
    pointSegmentDistance(box.maxX, box.maxZ, ax, az, bx, bz),
  );
}

// 높이 y에서 반경 radius(기본: NPC 반경) 구체가 from→to 직선을 장애물에 닿지 않고 지날 수 있는지.
// 면에 붙어 있는 출발점(거리 = 반경 + SKIN)도 통과로 본다.
export function isSegmentClear(
  world: CollisionWorld,
  from: THREE.Vector3,
  to: THREE.Vector3,
  y: number,
  radius = world.radius,
): boolean {
  const r = radius - 1e-4;
  for (const box of world.boxes) {
    if (!blocksAtHeight(box, y, world.radius)) continue;
    if (segmentRectDistance(from.x, from.z, to.x, to.z, box) < r) return false;
  }
  for (const c of world.circles) {
    if (!blocksAtHeight(c, y, world.radius)) continue;
    if (pointSegmentDistance(c.x, c.z, from.x, from.z, to.x, to.z) < c.radius + r) return false;
  }
  return true;
}

// 높이 y에서 점 주변 clearance 반경 안에 장애물이 없는지
export function isPointClear(
  world: CollisionWorld,
  x: number,
  z: number,
  y: number,
  clearance = world.radius,
): boolean {
  for (const box of world.boxes) {
    if (!blocksAtHeight(box, y, world.radius)) continue;
    if (pointRectDistance(x, z, box) < clearance - 1e-4) return false;
  }
  for (const c of world.circles) {
    if (!blocksAtHeight(c, y, world.radius)) continue;
    if (Math.hypot(x - c.x, z - c.z) - c.radius < clearance - 1e-4) return false;
  }
  return true;
}

// position에서 motion 방향으로 구체를 보내 처음 닿는 곳에서 멈춘다 (미끄러짐 없음).
// 목표 위치를 장애물 바깥, 출발점 쪽으로 끌어당길 때 쓴다.
export function castCircle(world: CollisionWorld, position: THREE.Vector3, motion: THREE.Vector3): boolean {
  const hit = sweepCircleXZ(world, position.x, position.y, position.z, motion.x, motion.z);
  const t = hit ? hit.t : 1;
  position.x += motion.x * t;
  position.z += motion.z * t;
  return hit !== null;
}
