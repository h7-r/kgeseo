// 흩뿌린 것들을 InstancedMesh 무리로 묶고, 손 편집(지움·고침·더함)을 그 위에 얹는다.
// 생성은 시드로 늘 같고 편집만 파일에 남는다 — 편집의 열쇠가 **생성 순서 번호**라서,
// 생성기의 반복 순서나 난수 소비 순서가 바뀌면 손 배치가 엉뚱한 물건에 붙는다.

import * as THREE from "three";
import { makeRandom } from "@/engine/random";
import { UNITS_PER_METER } from "../plan/sitePlan";

export type SpotColor = number | string;

/** 자리 하나. 좌표·키는 미터, 각은 라디안. */
export interface Spot {
  x: number;
  y: number;
  z: number;
  /** 키(m) — 표본이 높이 1 이라 그대로 배율이 된다 */
  size: number;
  rotation?: number;
  tilt?: number;
  tilt2?: number;
  widthRatio?: number;
  heightRatio?: number;
  depthRatio?: number;
  shapeIndex?: number;
  color?: SpotColor;
  /** 생성기가 번호를 정해 주는 단품(아비사·어부)만 쓴다 */
  id?: number;
}

export type SpotPatch = Partial<Spot>;

/** 편집 파일을 읽어 영어 열쇠로 바꾼 것. 저장할 때 editFile 이 옛 열쇠로 되돌린다. */
export interface Edits {
  removed: Record<string, number[]>;
  modified: Record<string, Record<number, SpotPatch>>;
  added: Record<string, Spot[]>;
}

export type PlacedSpot = Spot & { id: number };

export interface InstanceBatch {
  geometry: THREE.BufferGeometry;
  matrices: Float32Array;
  colors: Float32Array;
  ids: Int32Array;
  shapeIndex: number;
}

export interface InstanceGroup {
  groupId: string;
  batches: InstanceBatch[];
  doubleSided: boolean;
  material: THREE.Material | null;
}

export interface InstanceGroupOptions {
  /** 편집 파일의 열쇠다. 바꾸면 손 배치가 갈 곳을 잃는다. */
  groupId: string;
  shapes: THREE.BufferGeometry[];
  spots?: Spot[];
  edits?: Edits | null;
  /** 안쪽이 보이는 물건(배·꽃잎·풀잎). 단면이면 속이 뚫려 보이고 광선도 지나가 클릭이 안 된다. */
  doubleSided?: boolean;
  /** 텍스처 모형이 데려온 재질. 씬의 바닥재질은 정점 색 전용이라 맵을 못 본다. */
  material?: THREE.Material | null;
  /**
   * 키를 보고 모양을 고른다. 키는 편집이 바꾸므로 부르는 쪽이 미리 정하면 안 된다 —
   * 손으로 9 m 로 키운 바위가 성긴 모양을 받는다. 편집을 얹은 뒤의 키로 여기서 고른다.
   */
  shapeForSize?: ((size: number, id: number) => number) | null;
}

// 붙여넣은 것의 번호는 여기서부터 — 생성기 개수가 바뀌어도 더한 것의 번호가 안 밀린다
const ADDED_ID_START = 1000000;

const hasPatch = (patch: SpotPatch | undefined): patch is SpotPatch =>
  !!patch && typeof patch === "object" && Object.keys(patch).length > 0;

/**
 * 지움·고침·더함을 얹은 최종 자리 목록. 돌려주는 `id` 가 곧 편집 열쇠다.
 * 마을 울타리처럼 「사람이 옮긴 뒤의 집 자리」가 필요한 곳도 이걸 쓴다.
 */
export function applyEdits(groupId: string, spots: Spot[] = [], edits: Edits | null = null): PlacedSpot[] {
  const removed = new Set(edits?.removed?.[groupId] ?? []);
  const modified = edits?.modified?.[groupId] ?? {};
  const placed: PlacedSpot[] = [];
  for (let i = 0; i < spots.length; i++) {
    if (removed.has(i)) continue;
    const patch = modified[i];
    placed.push({ id: i, ...spots[i], ...(hasPatch(patch) ? patch : null) });
  }
  const added = edits?.added?.[groupId] ?? [];
  for (let i = 0; i < added.length; i++) {
    const id = ADDED_ID_START + i;
    if (removed.has(id)) continue;
    const patch = modified[id];
    placed.push({ id, ...added[i], ...(hasPatch(patch) ? patch : null) });
  }
  return placed;
}

const isFiniteOrMissing = (v: number | undefined) => v === undefined || Number.isFinite(v);

// NaN 하나만 섞여도 인스턴스 행렬이 망가지고, GPU 로 넘어가면 탭이 통째로 꺼진다
const isUsable = (spot: PlacedSpot) =>
  Number.isFinite(spot.x) &&
  Number.isFinite(spot.y) &&
  Number.isFinite(spot.z) &&
  Number.isFinite(spot.size) &&
  spot.size > 0 &&
  [spot.rotation, spot.tilt, spot.tilt2, spot.widthRatio, spot.heightRatio, spot.depthRatio].every(isFiniteOrMissing);

export function createInstanceGroup({
  groupId,
  shapes,
  spots = [],
  edits = null,
  doubleSided = false,
  material = null,
  shapeForSize = null,
}: InstanceGroupOptions): InstanceGroup | null {
  // 생성기 자리가 없어도 사람이 놓은 것(더함)만으로 무리가 선다
  const addedSpots = edits?.added?.[groupId] ?? [];
  if (!shapes?.length || (!spots.length && !addedSpots.length)) return null;

  const placed = applyEdits(groupId, spots, edits);
  if (!placed.length) return null;

  const usable = placed.filter(isUsable);
  if (usable.length !== placed.length && typeof console !== "undefined")
    console.warn(`[배치] ${groupId}: 못 쓸 값이 든 ${placed.length - usable.length}개를 건너뛴다`);
  if (!usable.length) return null;

  // 공간 칸으로도 쪼개 봤지만 이 맵은 어디서나 대부분이 시야에 들어와 드로우콜만 늘었다
  const buckets: PlacedSpot[][] = shapes.map(() => []);
  for (const spot of usable) {
    // 같은 번호는 늘 같은 모양. 사람이 적어 둔 모양이 먼저다.
    const chosen = spot.shapeIndex ?? (shapeForSize ? shapeForSize(spot.size, spot.id) : null) ?? spot.id;
    buckets[chosen % shapes.length].push(spot);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  const batches: InstanceBatch[] = [];
  for (let k = 0; k < shapes.length; k++) {
    const list = buckets[k];
    if (!list.length) continue;
    const matrices = new Float32Array(list.length * 16);
    const colors = new Float32Array(list.length * 3);
    const ids = new Int32Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const spot = list[i];
      const s = spot.size * UNITS_PER_METER;
      position.set(spot.x * UNITS_PER_METER, spot.y * UNITS_PER_METER, spot.z * UNITS_PER_METER);
      // YXZ — 편집기가 setFromQuaternion(q, "YXZ") 로 되읽는다. 다르면 복사한 기운 물건의 자세가 틀어진다.
      quaternion.setFromEuler(new THREE.Euler(spot.tilt ?? 0, spot.rotation ?? 0, spot.tilt2 ?? 0, "YXZ"));
      scale.set(s * (spot.widthRatio ?? 1), s * (spot.heightRatio ?? 1), s * (spot.depthRatio ?? 1));
      matrix.compose(position, quaternion, scale);
      matrix.toArray(matrices, i * 16);
      color.set(spot.color ?? 0xffffff);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      ids[i] = spot.id;
    }
    // 제 재질을 데려온 모형은 색 속성을 읽지도 않으니 흰색을 깔지 않는다
    if (!material) fillWhite(shapes[k]);
    batches.push({ geometry: shapes[k], matrices, colors, ids, shapeIndex: k });
  }
  return { groupId, batches, doubleSided, material };
}

// vertexColors 재질에 color 속성이 없으면 (0,0,0) 으로 읽혀 통째로 검게 나온다
function fillWhite(geometry: THREE.BufferGeometry) {
  if (!geometry || geometry.attributes.color) return;
  const count = geometry.attributes.position.count;
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
}

/**
 * 표본 규약: 높이 1 · 밑동이 원점. 그래야 자리의 키가 그대로 배율이 되고 y 가 땅에 닿는 점이 된다.
 * (반쯤 파묻히는 돌만 예외로 중심이 원점이다)
 */
export function toBaseOrigin(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const height = box.max.y - box.min.y || 1;
  geometry.translate(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
  geometry.scale(1 / height, 1 / height, 1 / height);
  return geometry;
}

const copyEdits = (edits: Edits | null | undefined): Edits => ({
  removed: { ...(edits?.removed ?? {}) },
  modified: { ...(edits?.modified ?? {}) },
  added: { ...(edits?.added ?? {}) },
});

export function removeInstances(edits: Edits, groupId: string, id: number): Edits {
  const next = copyEdits(edits);
  next.removed[groupId] = [...new Set([...(next.removed[groupId] ?? []), id])];
  return next;
}

export function modifyInstance(edits: Edits, groupId: string, id: number, patch: SpotPatch): Edits {
  const next = copyEdits(edits);
  const group = { ...(next.modified[groupId] ?? {}) };
  group[id] = { ...(group[id] ?? {}), ...patch };
  next.modified[groupId] = group;
  return next;
}

/** 사람이 더한 것을 쌓는다. 돌려주는 번호로 바로 고르기·옮기기를 이어 간다. */
export function addInstances(edits: Edits, groupId: string, spot: Spot): { edits: Edits; id: number } {
  const next = copyEdits(edits);
  const list = [...(next.added[groupId] ?? []), spot];
  next.added[groupId] = list;
  return { edits: next, id: ADDED_ID_START + list.length - 1 };
}

/** 저장 안 한 변경 수 */
export function countEdits(edits: Edits | null | undefined): number {
  let n = 0;
  for (const ids of Object.values(edits?.removed ?? {})) n += ids.length;
  for (const group of Object.values(edits?.modified ?? {})) n += Object.keys(group).length;
  for (const spots of Object.values(edits?.added ?? {})) n += spots.length;
  return n;
}

/** 흩뿌림 생성기가 내는 자리 — 키 하나뿐이다 */
export interface ScatterSpot {
  x: number;
  y: number;
  z: number;
  size?: number;
}

export interface JitterOptions {
  /** 높이비 범위 [최소, 최대] */
  flatten?: [number, number];
  /** 0~1 난수를 받아 16진 색을 낸다 */
  color?: (t: number) => number;
}

/**
 * 흩뿌린 돌 자리에 회전·납작함·색을 채운다.
 * 예전엔 지오를 만들며 굴리던 값을 자리로 올려, 편집기가 하나씩 돌리고 늘일 수 있게 했다.
 */
export function jitterStones(
  spots: ScatterSpot[],
  seed: number,
  { flatten = [0.45, 0.85], color }: JitterOptions = {},
): Spot[] {
  const random = makeRandom(seed >>> 0 || 1);
  // 필드 순서가 곧 난수 소비 순서다
  return spots.map((spot) => ({
    x: spot.x,
    y: spot.y,
    z: spot.z,
    size: spot.size ?? 1,
    rotation: random() * Math.PI * 2,
    tilt: (random() - 0.5) * 0.7,
    tilt2: (random() - 0.5) * 0.7,
    widthRatio: 0.7 + random() * 0.6,
    heightRatio: flatten[0] + random() * (flatten[1] - flatten[0]),
    depthRatio: 0.75 + random() * 0.5,
    color: color ? color(random()) : undefined,
  }));
}
