/**
 * 물건을 놓을 수 있는 곳을 찾고 겹치는지 검사한다.
 * 심즈·발하임·폴아웃4 정착지와 같은 뼈대 — 광선으로 놓을 면을 찾고, 발자국을 올려 보고,
 * 겹치면 빨강·괜찮으면 초록, 초록일 때만 놓는다. 놓을 면이 전부 축에 나란한 사각형이라
 * 광선↔평면 교차를 식 하나로 푼다(병합 메시·외곽선 껍데기에 Raycaster 를 쏘면 오히려 부정확하다).
 */
import { useSyncExternalStore } from "react";
import type * as THREE from "three";
import type { Vector3Tuple } from "three";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";

import type { Point3 } from "./interactions";

/** 바닥에 비친 발자국(축에 나란한 사각형). */
interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface SurfaceBox extends Footprint {
  top: number;
}

interface OccupiedBox extends Footprint {
  minY: number;
  maxY: number;
}

/** 벽·기둥처럼 높이가 없는 것은 minY/maxY 를 비워 둔다(높이 제한 없음). */
export interface WorldBox extends Footprint {
  minY?: number;
  maxY?: number;
}

interface ItemSize {
  /** 놓기 판정용 정사각 반폭 — 어느 각도로 돌려도 안전하다. */
  halfX: number;
  halfZ: number;
  height: number;
  /** 실제 밑면이 y prop 보다 얼마나 아래인가. 모자처럼 원점이 중간인 것만 값이 있다. */
  offset?: number;
  /** 돌리지 않은 진짜 반치수. 손에 든 물건을 몸에서 띄우는 데 쓴다. */
  trueHalfX?: number;
  trueHalfZ?: number;
}

/** 평면이 아닌 한 점으로 되돌려 놓는 자리(옷걸이의 모자). 광선↔수평면으로는 안 잡힌다. */
interface SnapPoint {
  itemId: string;
  x: number;
  y: number;
  z: number;
  rot?: number;
  /** 걸렸을 때의 자세. 유령도 같은 자세로 떠야 놓고 나서 딴 물건처럼 안 보인다. */
  tilt?: number;
  radius?: number;
}

const surfaces = new Map<string, SurfaceBox>();
const occupants = new Map<string, OccupiedBox>();
export const itemSizes = new Map<string, ItemSize>();
const snapPoints = new Map<string, SnapPoint>();

// 책상은 GLB 를 다 받은 뒤에야 잴 수 있어 첫 렌더에는 면이 없다. 면이 등록될 때 다시 그리게 알린다.
const surfaceSignal = createChangeSignal();
/** 면이 바뀔 때만 새 값을 주는 번호. useMemo 의존성에 넣어 쓴다. */
export const useSurfaceVersion = () =>
  useSyncExternalStore(surfaceSignal.subscribe, surfaceSignal.version, surfaceSignal.version);

export const registerSurface = (id: string, box: SurfaceBox) => {
  const previous = surfaces.get(id);
  surfaces.set(id, box);
  // 0.5초마다 같은 값으로 다시 재므로 진짜 바뀔 때만 알린다
  if (
    !previous ||
    previous.top !== box.top ||
    previous.minX !== box.minX ||
    previous.maxX !== box.maxX ||
    previous.minZ !== box.minZ ||
    previous.maxZ !== box.maxZ
  )
    surfaceSignal.notify();
};
export const unregisterSurface = (id: string) => {
  if (surfaces.delete(id)) surfaceSignal.notify();
};

/**
 * (x, z) 바로 아래 면의 윗높이. 겹치면 가장 높은 면. 없으면 null.
 * @param exclude 이 면은 안 본다. 자기 자신을 반드시 빼야 한다 — 물건 스스로가 면이면
 *   "내 윗면에 맞춰라 → 올라감 → 윗면도 올라감"으로 끝없이 기어오른다.
 */
export function findSurfaceHeightAt(x: number, z: number, exclude?: (id: string) => boolean) {
  let highest: number | null = null;
  for (const [id, box] of surfaces) {
    if (exclude && exclude(id)) continue;
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
    if (highest === null || box.top > highest) highest = box.top;
  }
  return highest;
}
export const registerOccupant = (id: string, box: OccupiedBox) => occupants.set(id, box);
export const unregisterOccupant = (id: string) => occupants.delete(id);
export const registerItemSize = (id: string, size: ItemSize) => itemSizes.set(id, size);

export const registerSnapPoint = (id: string, point: SnapPoint) => snapPoints.set(id, point);
export const unregisterSnapPoint = (id: string) => snapPoints.delete(id);

// 원래 자리가 아닌 곳에 옮겨진 물건들. 제자리로 되돌릴 때 처음부터 거기 있던 것까지
// 겹침으로 세면(옷걸이와 모자, 모니터와 키보드) 영영 못 되돌린다.
const movedItems = new Set<string>();
export const setMovedItems = (ids: Iterable<string>) => {
  movedItems.clear();
  for (const id of ids) movedItems.add(id);
};

// 통과 못 하는 것 목록은 충돌 모듈이 들고 있다. 여기서 import 하면 서로 물리므로 저쪽이 넣어 준다.
let worldBoxes: () => Iterable<WorldBox> = () => [];
export const provideWorldBoxes = (generator: () => Iterable<WorldBox>) => {
  worldBoxes = generator;
};

/** 3D 점 막힘 검사. 2D hit 는 책상을 높이 무한한 벽으로 봐서, 책상 위로 든 컵까지 막는다. */
function isBlocked3D(x: number, y: number, z: number, margin = 0, excludeId: string | null = null) {
  for (const [id, box] of occupants) {
    if (id === excludeId) continue;
    if (x < box.minX - margin || x > box.maxX + margin) continue;
    if (z < box.minZ - margin || z > box.maxZ + margin) continue;
    if (y >= box.minY - margin && y <= box.maxY + margin) return true;
  }
  for (const box of worldBoxes()) {
    if (x < box.minX - margin || x > box.maxX + margin) continue;
    if (z < box.minZ - margin || z > box.maxZ + margin) continue;
    if (box.minY === undefined) return true;
    if (box.maxY !== undefined && y >= box.minY - margin && y <= box.maxY + margin) return true;
  }
  return false;
}

// 맞닿는 것은 겹침이 아니다. 책상 윗면에 올리면 minY 가 maxY 와 정확히 같아진다.
const TOUCH_GAP = 0.02;
function isOverlapping(a: OccupiedBox, b: WorldBox) {
  if (a.maxX - TOUCH_GAP <= b.minX || a.minX + TOUCH_GAP >= b.maxX) return false;
  if (a.maxZ - TOUCH_GAP <= b.minZ || a.minZ + TOUCH_GAP >= b.maxZ) return false;
  const bMinY = b.minY ?? -1e4;
  const bMaxY = b.maxY ?? 1e4;
  if (a.maxY - TOUCH_GAP <= bMinY || a.minY + TOUCH_GAP >= bMaxY) return false;
  return true;
}

type PlacementBlockReason = "overlap" | "surfaceTooNarrow";

interface FoundPlacement extends ItemSize {
  found: true;
  /** 놓아도 되는가(초록/빨강). */
  ok: boolean;
  reason?: PlacementBlockReason;
  /** 있으면 "제자리로 되돌리기"다. */
  snapId?: string;
  x: number;
  /** 면 높이가 아니라 물건에 넘길 y 값(밑면 오프셋을 뺀 값). */
  y: number;
  z: number;
  rot: number;
  tilt?: number;
  surfaceTop?: number;
}

/** 면을 못 찾으면 found=false. ok 도 같이 두어 `r?.ok` 하나로 놓을 수 있는지 본다. */
type PlacementResult = { found: false; ok: false } | FoundPlacement;

const NOT_FOUND: PlacementResult = { found: false, ok: false };

/**
 * 화면 중앙이 가리키는 놓을 자리를 찾는다.
 * @param origin 거리를 재고 광선을 쏘는 기준점. 3인칭 카메라는 캐릭터 뒤 9.33 유닛이라
 *   그대로 쓰면 maxDistance(9)를 출발부터 넘는다. 방향은 늘 카메라 것이다.
 */
export function findPlacement(
  camera: THREE.Camera,
  itemId: string,
  maxDistance = 9,
  origin: Point3 | null = null,
): PlacementResult {
  const size = itemSizes.get(itemId);
  if (!size) return NOT_FOUND;

  const from = origin ?? camera.position;
  const direction = computeCameraForward(camera);

  // 걸이가 먼저다. 이 물건의 제자리가 시선에 걸리면 거기로 되돌린다.
  for (const [snapId, snap] of snapPoints) {
    if (snap.itemId !== itemId) continue;
    const hx = snap.x - from.x;
    const hy = snap.y - from.y;
    const hz = snap.z - from.z;
    const along = hx * direction.x + hy * direction.y + hz * direction.z;
    if (along <= 0.3 || along > maxDistance) continue;
    const sideSq = hx * hx + hy * hy + hz * hz - along * along;
    const radius = snap.radius ?? 1.0;
    if (sideSq > radius * radius) continue;

    // 제자리에 다른 물건을 옮겨다 놓았을 때만 빨강.
    const bottom = snap.y + (size.offset ?? 0);
    const homeBox: OccupiedBox = {
      minX: snap.x - size.halfX,
      maxX: snap.x + size.halfX,
      minZ: snap.z - size.halfZ,
      maxZ: snap.z + size.halfZ,
      minY: bottom,
      maxY: bottom + size.height,
    };
    let blocker: string | null = null;
    for (const [id, box] of occupants) {
      if (id === itemId || !movedItems.has(id)) continue;
      if (isOverlapping(homeBox, box)) {
        blocker = id;
        break;
      }
    }

    return {
      found: true,
      snapId,
      x: snap.x,
      y: snap.y,
      z: snap.z,
      rot: snap.rot ?? 0,
      tilt: snap.tilt ?? 0,
      halfX: size.halfX,
      halfZ: size.halfZ,
      height: size.height,
      ok: !blocker,
      reason: blocker ? "overlap" : undefined,
    };
  }

  // 광선 ↔ 각 면의 윗평면 교차. 가장 가까운 것 하나.
  let nearest: { t: number; px: number; pz: number; surface: SurfaceBox } | null = null;
  for (const surface of surfaces.values()) {
    if (Math.abs(direction.y) < 1e-4) continue;
    const t = (surface.top - from.y) / direction.y;
    if (t <= 0.3 || t > maxDistance) continue;
    const px = from.x + direction.x * t;
    const pz = from.z + direction.z * t;
    if (px < surface.minX || px > surface.maxX || pz < surface.minZ || pz > surface.maxZ) continue;
    if (!nearest || t < nearest.t) nearest = { t, px, pz, surface };
  }
  if (!nearest) return NOT_FOUND;

  const { px, pz, surface } = nearest;
  const y = surface.top;
  // 모델 앞면(+Z)이 사람 쪽을 보게 돌린다. 노트북 화면이 벽을 보면 어색하다.
  const rot = Math.atan2(-direction.x, -direction.z);

  // 가장자리에 걸치면 떠 보이므로 발자국을 면 안쪽으로 당긴다.
  const x = clamp(px, surface.minX + size.halfX, surface.maxX - size.halfX);
  const z = clamp(pz, surface.minZ + size.halfZ, surface.maxZ - size.halfZ);
  if (surface.maxX - surface.minX < size.halfX * 2 || surface.maxZ - surface.minZ < size.halfZ * 2)
    return { found: true, x: px, y, z: pz, rot, ...size, ok: false, reason: "surfaceTooNarrow" };

  const self: OccupiedBox = {
    minX: x - size.halfX,
    maxX: x + size.halfX,
    minZ: z - size.halfZ,
    maxZ: z + size.halfZ,
    minY: y,
    maxY: y + size.height,
  };
  for (const [id, box] of occupants) {
    if (id === itemId) continue;
    if (isOverlapping(self, box)) return { found: true, x, y, z, rot, ...size, ok: false, reason: "overlap" };
  }
  for (const box of worldBoxes()) {
    if (isOverlapping(self, box)) return { found: true, x, y, z, rot, ...size, ok: false, reason: "overlap" };
  }

  return { found: true, x, y: y - (size.offset ?? 0), z, rot, ...size, ok: true, surfaceTop: y };
}

/** 면이 물건보다 좁으면(lo > hi) 가운데에 둔다. */
const clamp = (value: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(value, lo), hi));

// 매번 새 벡터를 만들지 않도록 하나를 돌려 쓴다
const forward = { x: 0, y: 0, z: 0 };
function computeCameraForward(camera: THREE.Camera) {
  const elements = camera.matrixWorld.elements;
  // 카메라 시선은 -Z, 월드행렬 3열의 반대 방향이다.
  forward.x = -elements[8];
  forward.y = -elements[9];
  forward.z = -elements[10];
  const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
  forward.x /= length;
  forward.y /= length;
  forward.z /= length;
  return forward;
}

/**
 * 손에 든 물건이 벽·가구를 뚫지 않게 카메라 쪽으로 당긴다(3인칭 스프링 암과 같은 방식).
 * @param minDistance 아무리 막혀도 이보다 가깝게는 당기지 않는다. 눈까지 당기면 물건이
 *   근평면(0.25) 안으로 들어가 사라진다 — 책상에 살짝 파고드는 편이 낫다.
 */
export function computeSpringArmPoint(
  start: Vector3Tuple,
  target: Vector3Tuple,
  radius = 0.35,
  excludeId: string | null = null,
  steps = 8,
  minDistance = 0,
): Vector3Tuple {
  let last = start;
  const length = Math.hypot(target[0] - start[0], target[1] - start[1], target[2] - start[2]);
  const minK = length > 1e-6 ? Math.min(1, minDistance / length) : 0;
  const at = (k: number): Vector3Tuple => [
    start[0] + (target[0] - start[0]) * k,
    start[1] + (target[1] - start[1]) * k,
    start[2] + (target[2] - start[2]) * k,
  ];
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const [x, y, z] = at(k);
    if (isBlocked3D(x, y, z, radius, excludeId)) {
      return k <= minK || minK === 0 ? at(minK) : last;
    }
    last = [x, y, z];
  }
  return last;
}

// 매 프레임 바뀌는 놓을 자리. E 를 눌렀을 때 읽는다(구독 없음).
let latestResult: PlacementResult | null = null;
export const setLatestPlacement = (result: PlacementResult | null) => {
  latestResult = result;
};
export const getLatestPlacement = () => latestResult;

/**
 * 이 물건 윗면에 얹혀 있는 다른 물건. 없으면 null.
 * 받침을 들면 위엣것이 공중에 뜬다 — 받침을 못 들게 하는 쪽이 규칙이 단순하다.
 */
export function findItemOnTop(itemId: string) {
  const self = occupants.get(itemId);
  if (!self) return null;
  const selfArea = (self.maxX - self.minX) * (self.maxZ - self.minZ);
  for (const [id, box] of occupants) {
    if (id === itemId) continue;

    // 내 윗면에 앉아 있어야 한다. 내 몸에 파묻힌 것은 얹힌 게 아니다 —
    // 모니터 상자 밑면이 책상 아래까지 내려와 키보드가 영영 안 집혔다.
    if (box.minY < self.maxY - 0.03) continue;
    if (box.minY > self.maxY + 0.15) continue;

    // 모서리만 스친 것까지 세면 옆 물건 때문에 못 든다. 발자국 40% 이상 겹쳐야 한다.
    const overlapX = Math.min(box.maxX, self.maxX) - Math.max(box.minX, self.minX);
    const overlapZ = Math.min(box.maxZ, self.maxZ) - Math.max(box.minZ, self.minZ);
    if (overlapX <= TOUCH_GAP || overlapZ <= TOUCH_GAP) continue;
    const boxArea = (box.maxX - box.minX) * (box.maxZ - box.minZ);
    const smaller = Math.min(boxArea, selfArea);
    if (smaller <= 0 || (overlapX * overlapZ) / smaller < 0.4) continue;

    return id;
  }
  return null;
}

// 화면에 그려진 실물을 잰 값이라 "책상 위에 떠 있다" 같은 건 이걸로만 확인한다.
exposeDevHook("placement", { surfaces, occupants, itemSizes, snapPoints });
