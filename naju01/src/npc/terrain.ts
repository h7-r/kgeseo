// NPC 가 걷는 땅의 높이와 이동 가능 여부. 장애물(collision.ts)과 별개로 다룬다.
// 절벽·강·높은 턱은 '부딪히는 물체'가 아니라 '설 수 없는 땅'이라, 이동 경로를 촘촘히 짚어 본다.
// 모든 값은 미터(지도 좌표). 실제 지형(나주 맵 등)은 어댑터가 이 인터페이스로 감싸 넘긴다.

export type TerrainBlockReason = "water" | "fall" | "outside" | "restricted";

export interface TerrainSample {
  y: number; // 지면 고도 (m)
  walkable: boolean;
  reason: TerrainBlockReason | null; // walkable=false 일 때 이유
}

export interface NpcTerrain {
  sample(x: number, z: number): TerrainSample;
}

export const TERRAIN_CONFIG = {
  maxStep: 0.55, // 한 번에 오르내릴 수 있는 높이 차 (m) — 나주 플레이어의 STEP_HEIGHT 와 같다
  sampleSpacing: 0.25, // 경로를 짚는 간격 (m). NPC 반경(0.35)보다 촘촘해야 좁은 금지 구역을 놓치지 않는다
  footProbe: 0.2, // 발밑 높이를 잴 때 중심 둘레로 함께 보는 거리 (m)
} as const;

const PROBES: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// NPC 가 서 있을 지면 높이. 플레이어처럼 중심과 둘레 네 점 중 걸을 수 있는 가장 높은 곳을 밟는다
// (경사·턱 경계에서 몸이 땅에 묻히지 않게). 다섯 점 모두 못 걷는 곳이면 중심 높이를 쓴다.
export function groundHeight(terrain: NpcTerrain, x: number, z: number): number {
  const d = TERRAIN_CONFIG.footProbe;
  const center = terrain.sample(x, z);
  let best = center.walkable ? center.y : -Infinity;
  for (let i = 1; i < PROBES.length; i++) {
    const s = terrain.sample(x + PROBES[i][0] * d, z + PROBES[i][1] * d);
    if (s.walkable && s.y > best && s.y - center.y <= TERRAIN_CONFIG.maxStep) best = s.y;
  }
  return Number.isFinite(best) ? best : center.y;
}

// a → b 직선을 걸어갈 수 있는지: 짚는 모든 점이 걸을 수 있고, 이웃한 점 사이 높이 차가 턱 이하.
// escapeFromStart: 출발점이 이미 못 걷는 땅이면(외부 요인으로 밀려난 NPC 등) 그 구간을 지나
// 걸을 수 있는 땅에 처음 닿는 곳부터 판정한다. 그렇지 않으면 빠져나갈 길이 전부 막혀 영영 갇힌다.
export function isTerrainSegmentWalkable(
  terrain: NpcTerrain,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  escapeFromStart = false,
): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / TERRAIN_CONFIG.sampleSpacing));
  let previous: TerrainSample | null = terrain.sample(ax, az);
  if (!previous.walkable) {
    if (!escapeFromStart) return false;
    previous = null; // 아직 못 걷는 땅 위 — 걸을 수 있는 땅에 닿을 때까지 건너뛴다
  }
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const s = terrain.sample(ax + (bx - ax) * t, az + (bz - az) * t);
    if (previous === null) {
      if (s.walkable) previous = s;
      continue;
    }
    if (!s.walkable || Math.abs(s.y - previous.y) > TERRAIN_CONFIG.maxStep) return false;
    previous = s;
  }
  return previous !== null;
}

export interface TerrainMoveResult {
  x: number;
  z: number;
  blocked: boolean; // 원래 가려던 만큼 가지 못했는지
  blockedX: boolean; // X 축 이동이 막혔는지 (속도 성분을 지우는 데 쓴다)
  blockedZ: boolean;
  reason: TerrainBlockReason | "step" | null;
}

// 앞으로 갈 수 있는 마지막 점까지만 간다 (금지된 땅·턱 바로 앞에서 멈춤)
function walkUntilBlocked(
  terrain: NpcTerrain,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { x: number; z: number; complete: boolean; reason: TerrainBlockReason | "step" | null } {
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / TERRAIN_CONFIG.sampleSpacing));
  let previous = terrain.sample(ax, az);
  let lastX = ax;
  let lastZ = az;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const s = terrain.sample(x, z);
    if (!s.walkable) return { x: lastX, z: lastZ, complete: false, reason: s.reason };
    if (Math.abs(s.y - previous.y) > TERRAIN_CONFIG.maxStep) {
      return { x: lastX, z: lastZ, complete: false, reason: "step" };
    }
    previous = s;
    lastX = x;
    lastZ = z;
  }
  return { x: bx, z: bz, complete: true, reason: null };
}

// from → to 이동을 지형 기준으로 걸러 실제로 갈 자리를 정한다.
// 막히면 플레이어처럼 축을 나눠 미끄러져 보고(벽을 따라 걷기), 그래도 막히면 경계 바로 앞까지만 간다.
// 이미 못 걷는 땅에 서 있으면(외부 요인) 빠져나갈 수 있게 그대로 허용한다.
export function guardTerrainMove(
  terrain: NpcTerrain,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): TerrainMoveResult {
  if (!terrain.sample(fromX, fromZ).walkable) {
    return { x: toX, z: toZ, blocked: false, blockedX: false, blockedZ: false, reason: null };
  }
  const full = walkUntilBlocked(terrain, fromX, fromZ, toX, toZ);
  if (full.complete) {
    return { x: toX, z: toZ, blocked: false, blockedX: false, blockedZ: false, reason: null };
  }
  const alongX = walkUntilBlocked(terrain, fromX, fromZ, toX, fromZ);
  const alongZ = walkUntilBlocked(terrain, fromX, fromZ, fromX, toZ);
  // 한 축만으로 끝까지 갈 수 있으면 그 축으로 미끄러진다. 둘 다 되면 더 멀리 가는 쪽.
  const gainX = alongX.complete ? Math.abs(toX - fromX) : -1;
  const gainZ = alongZ.complete ? Math.abs(toZ - fromZ) : -1;
  if (gainX > 0 && gainX >= gainZ) {
    return { x: toX, z: fromZ, blocked: true, blockedX: false, blockedZ: true, reason: full.reason };
  }
  if (gainZ > 0) {
    return { x: fromX, z: toZ, blocked: true, blockedX: true, blockedZ: false, reason: full.reason };
  }
  return { x: full.x, z: full.z, blocked: true, blockedX: true, blockedZ: true, reason: full.reason };
}
