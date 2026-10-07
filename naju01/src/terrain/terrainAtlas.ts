// 지형 한 덩이를 Meshy 리텍스처에 넘길 수 있게 UV 를 얹고 GLB 로 뽑는다(개발용).
// Meshy 의 자체 언랩은 삼각형 4만 면 이하만 받는다. 우리가 UV 를 얹고 enable_original_uv 를 켜면 그 제한을 안 탄다.
// 지형을 코드로 만들어 어느 면이 땅이고 절벽인지 이미 알아서 가능한 일이다.
// 절벽·비탈·언덕을 한 덩이로 구워야 조각마다 다른 암석 재질이 나와 이음매에서 갈라지는 일이 없다.
// 위에서 편 투영(XZ)만 쓰면 74° 절벽이 3.6 배로 늘어난다 — 서 있는 면은 옆(XY)에서 펴서 다른 칸에 넣는다.
// 4K 한 장 기준 바닥칸 51 px/m, 절벽칸 98 px/m — 절벽은 코앞에서 보므로 두 배를 준다.
// 좌표는 한 점도 안 건드리고 UV 만 더한다. 그래야 구운 뒤에도 판정 숫자가 안 변한다.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MESH_NAMES } from "../plan/meshNames";
import { CLIFF, CORE, UNITS_PER_METER, type Range } from "../plan/sitePlan";

// instanceof 대신 is* 표식 — three 가 두 벌 실려도(도구·SSR) 원본처럼 메시를 알아본다
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;

export type AtlasCellName = "ground" | "cliff";

export interface CellRect {
  u: Range;
  v: Range;
}

interface ProjectionBox {
  min: [number, number, number];
  max: [number, number, number];
}

// 칸 가장자리 여백 — 텍스처가 이웃 칸으로 번지지 않게
const MARGIN = 0.004;

// 코어가 80 × 50 m(가로세로비 1.6)라 1.0 × 0.625 여야 가로세로 텍셀 밀도가 같다
const ATLAS_LAYOUT: Record<AtlasCellName, CellRect> = {
  ground: { u: [0, 1], v: [0, 0.625] },
  cliff: { u: [0, 0.56], v: [0.63, 1] },
};

// 씬 메시 이름으로 칸을 고른다.
// 절벽 발치 너덜은 절벽 칸이다 — 바닥 칸(위에서 편 투영)에 넣었더니 수직 벽 돌들이 흰 얼룩으로 뭉갰다.
const BAKE_TARGETS: Record<AtlasCellName, string[]> = {
  ground: [MESH_NAMES.ground, MESH_NAMES.path, MESH_NAMES.slope],
  cliff: [MESH_NAMES.cliffFace, MESH_NAMES.cliffScree],
};

// 투영 상자(미터)는 지오메트리에서 재지 않고 도면 숫자로 고정한다 — 절벽 높이를 바꿔도 UV 가 통째로 안 밀린다
const PROJECTION_BOXES: Record<AtlasCellName, ProjectionBox> = {
  ground: {
    min: [CORE.x[0], 0, CORE.z[0]],
    max: [CORE.x[1], 0, CORE.z[1]],
  },
  cliff: {
    min: [CLIFF.x[0] - 0.5, -0.5, 0],
    max: [CLIFF.x[1] + 0.5, 15.0, 0],
  },
};

// 흩어진 돌·퇴화면이 빌려 쓰는 순수 암반 구역(절벽 칸 안쪽). 밖으로 나가면 땅 그림을 물어 와 돌이 흙색이 된다.
const ROCK_CELL: CellRect = { u: [0.08, 0.45], v: [0.72, 0.95] };

const projectionAxis = (cell: AtlasCellName) => (cell === "cliff" ? "XY" : "XZ");

// 축 "XZ" = 위에서 본 투영(누운 면), "XY" = 옆에서 본 투영(선 면).
// XY 투영은 법선이 ±X 인 면을 한 줄로 뭉개 검은 쐐기가 된다(절벽 서쪽 마구리면) — 삼각형마다 보고 안 맞으면 바위칸으로 보낸다.
function planarUv(geo: THREE.BufferGeometry, axis: "XZ" | "XY", box: ProjectionBox, cell: CellRect) {
  const p = geo.attributes.position;
  const coords = p.array;
  const [ai, bi] = axis === "XZ" ? [0, 2] : [0, 1];
  const normalAxis = axis === "XZ" ? 1 : 2; // 이 축을 보는 면이라야 이 투영이 성립한다
  // 지오메트리는 유닛, 상자는 미터
  const minA = box.min[ai] * UNITS_PER_METER;
  const minB = box.min[bi] * UNITS_PER_METER;
  const width = (box.max[ai] - box.min[ai]) * UNITS_PER_METER;
  const height = (box.max[bi] - box.min[bi]) * UNITS_PER_METER;

  const cellWidth = cell.u[1] - cell.u[0] - MARGIN * 2;
  const cellHeight = cell.v[1] - cell.v[0] - MARGIN * 2;
  // 가로세로비를 지킨다
  const scale = Math.min(cellWidth / width, cellHeight / height);
  const offsetU = cell.u[0] + MARGIN + (cellWidth - width * scale) / 2;
  const offsetV = cell.v[0] + MARGIN + (cellHeight - height * scale) / 2;

  const uv = new Float32Array(p.count * 2);
  const tileSize = 3 * UNITS_PER_METER;
  let fallbacks = 0;
  for (let t = 0; t + 2 < p.count; t += 3) {
    const i0 = t * 3;
    const i1 = (t + 1) * 3;
    const i2 = (t + 2) * 3;
    const ux = coords[i1] - coords[i0];
    const uy = coords[i1 + 1] - coords[i0 + 1];
    const uz = coords[i1 + 2] - coords[i0 + 2];
    const wx = coords[i2] - coords[i0];
    const wy = coords[i2 + 1] - coords[i0 + 1];
    const wz = coords[i2 + 2] - coords[i0 + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    const length = Math.hypot(n[0], n[1], n[2]);
    // 0.30 이면 약 72° 까지 허용
    const fits = length > 1e-9 && Math.abs(n[normalAxis]) / length > 0.3;
    if (fits) {
      for (let k = 0; k < 3; k++) {
        const j = (t + k) * 3;
        uv[(t + k) * 2] = offsetU + (coords[j + ai] - minA) * scale;
        uv[(t + k) * 2 + 1] = offsetV + (coords[j + bi] - minB) * scale;
      }
    } else {
      boxProject(coords, t, uv, tileSize);
      fallbacks++;
    }
  }
  geo.userData.degenerateFallbacks = fallbacks;
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

// 삼각형 하나를 바위칸으로 상자 투영한다(면의 지배축을 골라). 접는 기준은 무게중심 —
// 꼭짓점마다 접으면 한 삼각형이 아틀라스를 가로질러 늘어난다.
function boxProject(coords: ArrayLike<number>, t: number, uv: Float32Array, tileSize: number) {
  const i0 = t * 3;
  const i1 = (t + 1) * 3;
  const i2 = (t + 2) * 3;
  const ux = coords[i1] - coords[i0];
  const uy = coords[i1 + 1] - coords[i0 + 1];
  const uz = coords[i1 + 2] - coords[i0 + 2];
  const wx = coords[i2] - coords[i0];
  const wy = coords[i2 + 1] - coords[i0 + 1];
  const wz = coords[i2 + 2] - coords[i0 + 2];
  const nx = Math.abs(uy * wz - uz * wy);
  const ny = Math.abs(uz * wx - ux * wz);
  const nz = Math.abs(ux * wy - uy * wx);
  let a: number;
  let b: number;
  if (nx >= ny && nx >= nz) {
    a = 2;
    b = 1;
  } else if (ny >= nz) {
    a = 0;
    b = 2;
  } else {
    a = 0;
    b = 1;
  }
  const width = ROCK_CELL.u[1] - ROCK_CELL.u[0];
  const height = ROCK_CELL.v[1] - ROCK_CELL.v[0];
  const foldA = Math.floor((coords[i0 + a] + coords[i1 + a] + coords[i2 + a]) / 3 / tileSize);
  const foldB = Math.floor((coords[i0 + b] + coords[i1 + b] + coords[i2 + b]) / 3 / tileSize);
  for (let k = 0; k < 3; k++) {
    const j = (t + k) * 3;
    const fa = THREE.MathUtils.clamp(coords[j + a] / tileSize - foldA, 0, 1);
    const fb = THREE.MathUtils.clamp(coords[j + b] / tileSize - foldB, 0, 1);
    uv[(t + k) * 2] = ROCK_CELL.u[0] + fa * width;
    uv[(t + k) * 2 + 1] = ROCK_CELL.v[0] + fb * height;
  }
}

/**
 * 흩어진 바위(자갈·구역바위·발치너덜·길가돌)에 화강암 UV 를 얹는다. 아틀라스에 제 자리가 없어 민짜 회색으로 남으면
 * 텍스처 입힌 절벽 앞에서 공중에 떠 보인다. 비인덱스만 다룬다(삼각형마다 접어야 하므로).
 */
export function applyRockUv(geo: THREE.BufferGeometry, tile = 3) {
  const p = geo.attributes.position;
  if (geo.index) return false;
  const coords = p.array;
  const uv = new Float32Array(p.count * 2);
  const tileSize = tile * UNITS_PER_METER;
  for (let t = 0; t < p.count; t += 3) boxProject(coords, t, uv, tileSize);
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return true;
}

/** 구운 재질을 같이 입는 돌 메시들 — 아틀라스 자리 없이 절벽 칸의 화강암을 빌린다. */
export const ROCK_TARGETS: string[] = [
  MESH_NAMES.groundPebbles,
  MESH_NAMES.zoneSides,
  MESH_NAMES.blockerRock,
  MESH_NAMES.blockerFootScree,
  MESH_NAMES.pathStones,
  MESH_NAMES.pathCrevasseRocks,
  MESH_NAMES.pathSlopeRocks,
  MESH_NAMES.cliffBoulders,
];

/** 살아 있는 메시에 내보낼 때와 같은 UV 를 얹는다 — 같은 함수라 어긋날 수 없다. */
export function applyCellUv(geo: THREE.BufferGeometry, cell: AtlasCellName) {
  if (!ATLAS_LAYOUT[cell]) return false;
  planarUv(geo, projectionAxis(cell), PROJECTION_BOXES[cell], ATLAS_LAYOUT[cell]);
  return true;
}

/** 메시 이름으로 어느 칸인지 되찾는다. */
export function findCell(name: string): AtlasCellName | null {
  for (const [cell, names] of Object.entries(BAKE_TARGETS) as [AtlasCellName, string[]][])
    if (names.includes(name)) return cell;
  return null;
}

/**
 * 세계 사각형(m) → 바닥 칸의 아틀라스 사각형. 위에서 편 평면 투영이라 축 나란한 사각형이 그대로 옮겨진다.
 * 텍스처 합치기 도구가 다시 계산하면 언젠가 어긋나므로 내보낼 때 이 값을 .json 으로 같이 적는다.
 */
export function groundCellRect(xRange: Range, zRange: Range): CellRect {
  const cell = ATLAS_LAYOUT.ground;
  const box = PROJECTION_BOXES.ground;
  const minA = box.min[0] * UNITS_PER_METER;
  const minB = box.min[2] * UNITS_PER_METER;
  const width = (box.max[0] - box.min[0]) * UNITS_PER_METER;
  const height = (box.max[2] - box.min[2]) * UNITS_PER_METER;
  const cellWidth = cell.u[1] - cell.u[0] - MARGIN * 2;
  const cellHeight = cell.v[1] - cell.v[0] - MARGIN * 2;
  const scale = Math.min(cellWidth / width, cellHeight / height);
  const offsetU = cell.u[0] + MARGIN + (cellWidth - width * scale) / 2;
  const offsetV = cell.v[0] + MARGIN + (cellHeight - height * scale) / 2;
  const uv = (x: number, z: number) => [
    offsetU + (x * UNITS_PER_METER - minA) * scale,
    offsetV + (z * UNITS_PER_METER - minB) * scale,
  ];
  const [u0, v0] = uv(xRange[0], zRange[0]);
  const [u1, v1] = uv(xRange[1], zRange[1]);
  return { u: [Math.min(u0, u1), Math.max(u0, u1)], v: [Math.min(v0, v1), Math.max(v0, v1)] };
}

export interface TerrainZone {
  x: Range;
  z: Range;
  /** 주면 이 아틀라스 사각형이 0~1 을 꽉 채우게 UV 를 편다 */
  rect?: CellRect | null;
}

export interface CollectOptions {
  vertexColors?: boolean;
  /** 이 칸만 모은다 */
  cell?: AtlasCellName | null;
  /** 이 세계 사각형 안의 삼각형만 남긴다 */
  zone?: TerrainZone | null;
}

export type TerrainStats = Partial<Record<AtlasCellName, number>>;

/**
 * 씬의 지형 조각을 모아 한 덩이로(원본은 clone — 씬은 계속 돈다).
 * 정점색: 안 실으면 거의 백색 단색으로 돌아왔다. 우리 정점색이 재료 단서라 고를 수 있게 뒀다.
 * 칸: Meshy 는 한 모델에 재질 하나만 입힌다. 칸별로 따로 구워도 UV 는 전체 배치라 같은 자리에 합칠 수 있다.
 * 구역: 그 구역의 아틀라스 사각형만 오려 붙이면 구역마다 다른 재질을 입힐 수 있다.
 */
export function collectTerrain(
  scene: THREE.Object3D,
  { vertexColors = false, cell = null, zone = null }: CollectOptions = {},
) {
  const pieces: THREE.BufferGeometry[] = [];
  const stats: TerrainStats = {};

  for (const [cellName, names] of Object.entries(BAKE_TARGETS) as [AtlasCellName, string[]][]) {
    if (cell && cellName !== cell) continue;
    scene.traverse((o) => {
      if (!isMesh(o) || !names.includes(o.name)) return;
      const source = o.geometry as THREE.BufferGeometry;
      const g = source.clone();
      // 부모 변환까지 반영해 월드 좌표로 굳힌다
      o.updateWorldMatrix(true, false);
      g.applyMatrix4(o.matrixWorld);
      // mergeGeometries 는 속성 구성이 똑같아야 합친다
      const keep = vertexColors ? ["position", "normal", "color"] : ["position", "normal"];
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      // 색 없는 조각이 섞이면 합치기가 실패한다 — 흰색으로 형식을 맞춘다
      if (vertexColors && !g.attributes.color) {
        const n = g.attributes.position.count;
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      if (g.index) {
        const n = g.toNonIndexed();
        g.dispose();
        planarUv(n, projectionAxis(cellName), PROJECTION_BOXES[cellName], ATLAS_LAYOUT[cellName]);
        pieces.push(n);
      } else {
        planarUv(g, projectionAxis(cellName), PROJECTION_BOXES[cellName], ATLAS_LAYOUT[cellName]);
        pieces.push(g);
      }
      stats[cellName] = (stats[cellName] ?? 0) + source.attributes.position.count / 3;
    });
  }

  if (!pieces.length) return null;
  let merged: THREE.BufferGeometry | null = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());

  if (zone) {
    merged = cropToRect(merged, zone, zone.rect ?? null);
    if (!merged) return null;
  }
  merged.computeBoundingBox();
  return { geometry: merged, stats };
}

/**
 * 우리 정점색을 아틀라스 그림으로 굽는다. 정점색 속성(COLOR_0)은 Meshy 가 처리에 실패해서 그림으로 넘긴다.
 * 세로로 뒤집지 않는다 — v = 0 이 프레임버퍼 0행에 그려지고 PNG 0행·glTF v = 0 도 위라 그대로 담으면 맞는다(뒤집었다가 절벽 칸이 올라갔다).
 * 렌더 타깃은 선형 값을 담으므로 sRGB 로 지정해야 탁하고 어둡게 안 나온다.
 */
export function bakeUnderpaint(renderer: THREE.WebGLRenderer, geo: THREE.BufferGeometry, size = 2048) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  const color = geo.attributes.color;
  if (!uv || !color) throw new Error("밑그림을 구우려면 uv 와 color 가 둘 다 있어야 한다");

  // 위치를 UV 로 갈아 끼운 납작한 지오 — 아틀라스를 정면에서 본 셈
  const flat = new THREE.BufferGeometry();
  const positions = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    positions[i * 3] = uv.getX(i) * 2 - 1;
    positions[i * 3 + 1] = uv.getY(i) * 2 - 1;
  }
  flat.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  flat.setAttribute("color", color.clone());

  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(flat, material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const target = new THREE.WebGLRenderTarget(size, size);
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const previousTarget = renderer.getRenderTarget();
  const previousColor = new THREE.Color();
  renderer.getClearColor(previousColor);
  const previousAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(target);
  // 빈 칸은 흙색으로 — 검게 두면 Meshy 가 그늘이나 구멍으로 읽는다
  renderer.setClearColor(0x8a7c63, 1);
  renderer.clear();
  renderer.render(scene, camera);

  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousColor, previousAlpha);
  target.dispose();
  flat.dispose();
  material.dispose();

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d 캔버스를 만들 수 없다");
  const image = context.createImageData(size, size);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * 무게중심이 세계 사각형 안인 삼각형만 남긴다.
 * 구역 하나는 아틀라스의 5 % 남짓이라 Meshy 가 「UV 커버리지가 너무 작다」로 거부했다 — 그 사각형이 0~1 을 채우게 편다.
 * 사각형 밖으로 나가는 삼각형(급사면 → 바위칸)은 버린다. 최종 화면에서 바위칸을 보므로 구역 굽기와 무관하다.
 */
function cropToRect(geo: THREE.BufferGeometry, { x: X, z: Z }: TerrainZone, unfold: CellRect | null = null) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  const names = Object.keys(geo.attributes);
  const kept: number[] = [];
  const inside = (u: number, v: number) =>
    !unfold ||
    (u >= unfold.u[0] - 1e-4 && u <= unfold.u[1] + 1e-4 && v >= unfold.v[0] - 1e-4 && v <= unfold.v[1] + 1e-4);
  for (let t = 0; t + 2 < p.count; t += 3) {
    const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3 / UNITS_PER_METER;
    const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3 / UNITS_PER_METER;
    if (!(cx >= X[0] && cx <= X[1] && cz >= Z[0] && cz <= Z[1])) continue;
    if (uv && unfold) {
      let allInside = true;
      for (let i = 0; i < 3; i++)
        if (!inside(uv.getX(t + i), uv.getY(t + i))) {
          allInside = false;
          break;
        }
      if (!allInside) continue;
    }
    kept.push(t);
  }
  if (!kept.length) return null;
  const cropped = new THREE.BufferGeometry();
  for (const name of names) {
    const a = geo.attributes[name];
    const n = a.itemSize;
    const data = new Float32Array(kept.length * 3 * n);
    let k = 0;
    for (const t of kept) for (let i = 0; i < 3; i++) for (let c = 0; c < n; c++) data[k++] = a.array[(t + i) * n + c];
    cropped.setAttribute(name, new THREE.BufferAttribute(data, n));
  }
  if (unfold && cropped.attributes.uv) {
    const a = cropped.attributes.uv.array;
    const du = unfold.u[1] - unfold.u[0];
    const dv = unfold.v[1] - unfold.v[0];
    for (let i = 0; i < a.length; i += 2) {
      a[i] = THREE.MathUtils.clamp((a[i] - unfold.u[0]) / du, 0, 1);
      a[i + 1] = THREE.MathUtils.clamp((a[i + 1] - unfold.v[0]) / dv, 0, 1);
    }
    cropped.attributes.uv.needsUpdate = true;
  }
  geo.dispose();
  return cropped;
}

export interface ExportOptions extends CollectOptions {
  /** 정점색을 아틀라스 그림으로 구워 baseColorTexture 로 넣는다 */
  underpaint?: boolean;
  underpaintSize?: number;
}

export interface TerrainExport {
  buffer: ArrayBuffer | { [key: string]: unknown };
  stats: TerrainStats;
}

/** GLB 로 뽑는다. 위치+법선+UV 만 담아 약 8~9 MB(Meshy 한도 100 MB 의 9 %). */
export function exportTerrainGlb(
  scene: THREE.Object3D,
  options: ExportOptions = {},
  renderer: THREE.WebGLRenderer | null = null,
): Promise<TerrainExport> {
  // 밑그림을 구우려면 색을 모아야 한다(그림으로 바꾼 뒤엔 속성을 버린다)
  const needsColor = !!(options.vertexColors || options.underpaint);
  const collected = collectTerrain(scene, {
    vertexColors: needsColor,
    cell: options.cell ?? null,
    zone: options.zone ?? null,
  });
  if (!collected) return Promise.reject(new Error("구울 지형 조각을 못 찾았다"));

  let underpaintCanvas: HTMLCanvasElement | null = null;
  if (options.underpaint) {
    if (!renderer) return Promise.reject(new Error("밑그림을 구우려면 렌더러가 필요하다"));
    underpaintCanvas = bakeUnderpaint(renderer, collected.geometry, options.underpaintSize ?? 2048);
    if (!options.vertexColors) collected.geometry.deleteAttribute("color");
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: !!collected.geometry.attributes.color,
  });
  if (underpaintCanvas) {
    const texture = new THREE.CanvasTexture(underpaintCanvas);
    texture.flipY = false; // glTF 규약
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
  }
  const mesh = new THREE.Mesh(collected.geometry, material);
  mesh.name = MESH_NAMES.terrainExport;
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      mesh,
      (result) => resolve({ buffer: result, stats: collected.stats }),
      (error) => reject(error),
      { binary: true },
    );
  });
}
