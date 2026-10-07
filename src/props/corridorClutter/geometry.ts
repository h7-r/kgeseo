/**
 * 복도 바닥 잡동사니·웅덩이·부식 자국의 지오메트리.
 * 40여 개를 따로 그리면 외곽선까지 80 드로우콜이라, 재질이 같은 것끼리 합치고 색은 정점색으로 물건마다 다르게 넣는다.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";
import { CAN_FLAVORS } from "@/props/vending/canLabels";

type Random = () => number;
type Rgb = [number, number, number];

/** z 에 따른 깊이 감광. App 이 한 번만 만들어 넘기는 함수라 의존성에 넣어도 안전하다. */
export type BrightnessAt = (z: number) => number;

// 위치로만 정해지는 잡음. 비인덱스 지오는 모서리마다 정점이 겹쳐 있어 난수를 쓰면 면이 찢어진다.
function positionNoise(x: number, y: number, z: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 찌그러뜨린다. 0 = 멀쩡, 1 = 밟혀 납작. 버려진 캔은 찌그러진 모양 때문에 캔으로 읽힌다.
 * 아코디언 주름 · 밟힌 방향으로만 납작 · 접힌 만큼 낮아짐 · 축이 살짝 S 자로 휨.
 */
function crush(g: THREE.BufferGeometry, amount: number, r: Random) {
  if (amount <= 0) return g;
  const p = g.attributes.position;
  const folds = 2 + Math.floor(r() * 3);
  const phase = r() * Math.PI * 2;
  const direction = r() * Math.PI * 2;
  const bend = (r() - 0.5) * 0.5 * amount;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const radial = Math.hypot(x, z);
    if (radial > 1e-5) {
      const wrinkle = 1 + amount * 0.3 * Math.sin(y * Math.PI * folds + phase);
      const angle = Math.atan2(z, x) - direction;
      const c = Math.cos(angle);
      const flatten = 1 - amount * 0.62 * c * c;
      const k = wrinkle * flatten;
      x *= k;
      z *= k;
    }
    y *= 1 - amount * 0.5;
    x += bend * Math.sin(y * 3.4);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * 옆선([반지름, 높이])을 돌린 뒤 비인덱스로 바꾼다. 합칠 때 인덱스 유무가 섞이면 mergeGeometries 가 통째로 실패한다.
 * UV 손질은 인덱스가 있는 동안 해야 정점이 적어 싸다.
 */
function latheNonIndexed(
  profile: readonly [number, number][],
  segments: number,
  adjust?: (g: THREE.BufferGeometry) => void,
) {
  const lathe = new THREE.LatheGeometry(
    profile.map(([a, b]) => new THREE.Vector2(a, b)),
    segments,
  );
  if (adjust) adjust(lathe);
  const result = lathe.toNonIndexed();
  lathe.dispose();
  return result;
}

// 높이 1·지름 1. 몸통에 고리를 여러 개 둬야 찌그러뜨릴 때 주름이 잡힌다(두 줄뿐이면 통이 기울기만 한다).
const CAN_PROFILE: [number, number][] = [
  [0.0, 0.02],
  [0.3, 0.0],
  [0.44, 0.03],
  [0.47, 0.08],
  [0.5, 0.16],
  [0.5, 0.31],
  [0.5, 0.46],
  [0.5, 0.61],
  [0.5, 0.76],
  [0.45, 0.86],
  [0.36, 0.94],
  [0.35, 1.0],
  [0.3, 0.98],
  [0.0, 0.97],
];

// 아래가 좁고 위 테가 말려 있다
const CUP_PROFILE: [number, number][] = [
  [0.0, 0.0],
  [0.3, 0.0],
  [0.32, 0.03],
  [0.37, 0.31],
  [0.41, 0.58],
  [0.45, 0.86],
  [0.5, 0.94],
  [0.47, 1.0],
  [0.42, 0.96],
  [0.0, 0.95],
];

/** 벽에서 떨어져 나온 벽돌 조각. breakage 0 = 온전, 1 = 반쯤 부서짐. 반듯하면 벽돌이 아니라 상자다. */
function brickGeometry(r: Random, breakage = 0.5) {
  const box = new THREE.BoxGeometry(1, 0.46, 0.3, 4, 2, 2);
  const g = box.toNonIndexed();
  box.dispose();
  const p = g.attributes.position;
  const seed = r() * 8;
  const brokenSide = r() < 0.5 ? 1 : -1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const j = positionNoise(x * 7 + seed, y * 7, z * 7);
    // 부러진 한쪽 끝은 울퉁불퉁하고, 모서리는 어디든 조금씩 갉아 먹혔다
    const end = Math.max(0, x * brokenSide - 0.12) / 0.38;
    const chip = 0.03 * (j - 0.5);
    p.setXYZ(
      i,
      // 잡음만 곱하면 j≈0 인 정점이 안 움직인다. 고정분 0.3 이 있어야 귀퉁이가 뭉텅 없어진다.
      x - brokenSide * end * breakage * (0.3 + 0.28 * j) + chip,
      y * (1 - end * breakage * 0.3 * j) + chip,
      z * (1 - end * breakage * 0.25 * (1 - j)) + chip,
    );
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// 낡아서 붉은기가 죽은 흙빛. 회색 블록도 섞인다.
const BRICK_TONES = ["#6b4a3c", "#5e4438", "#734f3e", "#585a5e", "#4e463f"];

const scratchColor = new THREE.Color();
const scratchColor2 = new THREE.Color();
const BARE_STEEL = new THREE.Color("#8b9095");

/** 정점색을 굽는다. paint 가 null 을 주면 기본색. */
function bakeColors(
  g: THREE.BufferGeometry,
  base: Rgb | null,
  paint?: (x: number, y: number, z: number, heightRatio: number) => Rgb | null,
) {
  const p = g.attributes.position;
  g.computeBoundingBox();
  const box = g.boundingBox ?? new THREE.Box3();
  const y0 = box.min.y;
  const span = Math.max(1e-5, box.max.y - y0);
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const painted = paint ? paint(p.getX(i), p.getY(i), p.getZ(i), (p.getY(i) - y0) / span) : null;
    const v = painted ?? base ?? [1, 1, 1];
    colors[i * 3] = v[0];
    colors[i * 3 + 1] = v[1];
    colors[i * 3 + 2] = v[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function paintBrick(g: THREE.BufferGeometry, r: Random, shade: number) {
  const base = scratchColor.set(BRICK_TONES[Math.floor(r() * BRICK_TONES.length)]).clone();
  const brokenFace = scratchColor2.set("#8a7b6d").clone(); // 갓 깨진 속은 밝고 부슬부슬하다
  const seed = r() * 5;
  bakeColors(g, null, (px, py, pz) => {
    const grain = 0.82 + 0.34 * positionNoise(px * 24 + seed, py * 24, pz * 24);
    // 길이 끝일수록 깨진 속살이 드러난다
    const inner = Math.max(0, Math.abs(px) - 0.3) * 1.6;
    const c = base.clone().lerp(brokenFace, Math.min(0.55, inner));
    const v = shade * grain;
    return [c.r * v, c.g * v, c.b * v];
  });
}

/** 한쪽이 휘어 들린 녹슨 철판 조각. */
function rustyPlateGeometry(r: Random) {
  const plane = new THREE.PlaneGeometry(1, 0.6, 4, 3);
  const g = plane.toNonIndexed();
  plane.dispose();
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  // 말림이 세면 키운 뒤 20cm 넘게 들려 세워 둔 판처럼 보인다
  const curl = 0.13 + r() * 0.2;
  const seed = r() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const u = x + 0.5;
    const y = curl * u * u + 0.035 * Math.sin(x * 9 + seed) * Math.cos(z * 11);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** 바닥에 눌린 채 귀퉁이가 말린 종이. 바닥에 딱 붙은 판은 종이로 안 보인다. */
function paperGeometry(r: Random, adjust?: (g: THREE.BufferGeometry) => void) {
  const plane = new THREE.PlaneGeometry(1, 0.72, 5, 4);
  if (adjust) adjust(plane);
  const g = plane.toNonIndexed();
  plane.dispose();
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const curl = 0.12 + r() * 0.22;
  const axis = r() < 0.5 ? 1 : -1;
  const wave = r() * Math.PI;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const u = (x * axis + 0.5) / 1;
    const y = curl * u * u + 0.03 * Math.sin(x * 6 + wave) * (0.4 + u);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** 종이 아틀라스 칸 */
export const PAPER_CELL = { receipt: 0, flyer: 1, newspaper: 2, oldPaper: 3 } as const;
export const PAPER_COLUMNS = 2;
export const PAPER_ROWS = 2;

/** 캔 라벨 아틀라스 칸 배치 */
export const CAN_ATLAS_COLUMNS = 3;
export const CAN_ATLAS_ROWS = 2;

type ClutterKind = "can" | "cup" | "paper" | "brick" | "rustyPlate";

interface ClutterType {
  kind: ClutterKind;
  weight: number;
  paperCell?: number;
  /** 종이 가로·세로 비율 */
  aspect?: [number, number];
}

// 남긴 것은 전부 한눈에 무엇인지 읽히는 크기다(병뚜껑·꽁초는 점으로만 보여 뺐다).
const CLUTTER_TYPES: ClutterType[] = [
  { kind: "can", weight: 6 },
  { kind: "cup", weight: 3 },
  // 종이는 인쇄면이 있어야 종이로 읽힌다 → 아틀라스 칸을 하나씩 쓴다
  { kind: "paper", weight: 3, paperCell: PAPER_CELL.receipt, aspect: [0.42, 1.0] },
  { kind: "paper", weight: 2, paperCell: PAPER_CELL.flyer, aspect: [1.0, 0.78] },
  { kind: "paper", weight: 2, paperCell: PAPER_CELL.newspaper, aspect: [1.0, 0.8] },
  { kind: "paper", weight: 2, paperCell: PAPER_CELL.oldPaper, aspect: [0.85, 1.0] },
  { kind: "brick", weight: 3 },
  { kind: "rustyPlate", weight: 2 },
];
const WEIGHTED_PICKS = CLUTTER_TYPES.flatMap((type, i) => Array<number>(type.weight).fill(i));

// 칸 경계에 딱 붙이면 선형 보간이 옆 칸 색을 한 줄 끌어온다. 텍셀 두 칸쯤 안으로 들인다.
const CELL_MARGIN = 0.012;

/** UV 를 아틀라스 한 칸으로 옮긴다. */
function toAtlasCell(g: THREE.BufferGeometry, cell: number, columns: number, rows: number) {
  const uv = g.attributes.uv;
  if (!uv) return g;
  const cx = cell % columns;
  const cy = Math.floor(cell / columns);
  const m = CELL_MARGIN;
  for (let i = 0; i < uv.count; i++) {
    const u = m + uv.getX(i) * (1 - 2 * m);
    const v = m + uv.getY(i) * (1 - 2 * m);
    uv.setXY(i, (cx + u) / columns, (rows - cy - 1 + v) / rows);
  }
  uv.needsUpdate = true;
  return g;
}

function mergeAndDispose(pieces: THREE.BufferGeometry[]) {
  if (!pieces.length) return null;
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

interface ClutterOptions {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  count: number;
  seed: number;
  brightness: BrightnessAt;
  floorY: number;
  size?: number;
}

/** 캔·종이는 라벨·인쇄 그림(아틀라스)을 써서 재질이 달라 따로 뺀다. */
export function clutterGeometry({ x0, x1, z0, z1, count, seed, brightness, floorY, size = 1 }: ClutterOptions) {
  const r = makeRandom(seed);
  const width = x1 - x0;
  const cans: THREE.BufferGeometry[] = [];
  const papers: THREE.BufferGeometry[] = [];
  const others: THREE.BufferGeometry[] = [];

  for (let i = 0; i < count; i++) {
    const type = CLUTTER_TYPES[WEIGHTED_PICKS[Math.floor(r() * WEIGHTED_PICKS.length)]];

    // 쓸려 다니는 쓰레기는 벽 밑에 모이고, 가운데가 비면 지나다니는 길이 생긴다.
    const nearWall = r() < 0.72;
    const u = nearWall ? (r() < 0.5 ? 0.06 : 0.94) + (r() - 0.5) * 0.16 : 0.22 + r() * 0.56;
    const x = x0 + Math.min(0.96, Math.max(0.04, u)) * width;
    const z = z0 + r() * (z1 - z0);
    const shade = Math.max(0.12, brightness(z));

    let g: THREE.BufferGeometry;
    let bucket = others;
    let againstWall = false;
    const isLeftWall = x < (x0 + x1) / 2;

    if (type.kind === "can") {
      bucket = cans;
      const roll = r();
      // 절반쯤은 제대로 밟혀 있다. 멀쩡한 캔만 굴러다니면 소품 배치로 보인다.
      const amount = roll < 0.28 ? 0.08 + r() * 0.12 : roll < 0.72 ? 0.4 + r() * 0.2 : 0.72 + r() * 0.2;
      const cell = Math.floor(r() * CAN_FLAVORS.length);
      g = latheNonIndexed(CAN_PROFILE, 10, (a) => toAtlasCell(a, cell, CAN_ATLAS_COLUMNS, CAN_ATLAS_ROWS));
      crush(g, amount, r);
      g.scale(0.19 * size, 0.44 * size, 0.19 * size);
      // 서 있는 캔은 방금 놓은 것처럼 보여 드물어야 한다
      if (r() > 0.12) g.rotateX(Math.PI / 2 + (r() - 0.5) * 0.5);
      const v = shade * (0.8 + r() * 0.3);
      bakeColors(g, [v, v, v]);
    } else if (type.kind === "cup") {
      const amount = 0.35 + r() * 0.5;
      g = latheNonIndexed(CUP_PROFILE, 10);
      crush(g, amount, r);
      g.scale(0.17 * size, 0.3 * size, 0.17 * size);
      if (r() > 0.25) g.rotateX(Math.PI / 2 + (r() - 0.5) * 0.6);
      // 아래로 갈수록 진한 커피 자국 — 이게 있어야 쓰던 컵이다
      scratchColor.set("#d6cfbe");
      scratchColor2.set("#4a3524");
      bakeColors(g, null, (px, py, pz, h) => {
        const stain = Math.max(0, 1 - h * 2.1) * (0.55 + 0.45 * positionNoise(px * 9, py * 9, pz * 9));
        const c = scratchColor.clone().lerp(scratchColor2, Math.min(0.85, stain));
        const v = shade * (0.85 + 0.25 * positionNoise(px * 3, py * 3, pz * 3));
        return [c.r * v, c.g * v, c.b * v];
      });
    } else if (type.kind === "paper") {
      bucket = papers;
      const cell = type.paperCell ?? 0;
      g = paperGeometry(r, (a) => toAtlasCell(a, cell, PAPER_COLUMNS, PAPER_ROWS));
      const [bw, bh] = type.aspect ?? [1, 1];
      const s = (0.34 + r() * 0.18) * size;
      g.scale(s * bw, size, s * bh);
      g.rotateY(r() * Math.PI * 2);
      // 때는 아틀라스에 구워 뒀다. 밝기만 정점색으로 얹는다.
      const v = shade * (0.85 + r() * 0.28);
      bakeColors(g, [v, v, v]);
    } else if (type.kind === "brick") {
      // 벽에서 떨어진 것이니 벽 밑에 있어야 한다 — 바닥 한가운데 벽돌은 '왜 여기 있지' 가 된다.
      againstWall = true;
      const breakage = r() < 0.35 ? 0.15 : 0.5 + r() * 0.5;
      g = brickGeometry(r, breakage);
      const s = (0.5 + r() * 0.22) * size;
      g.scale(s, s, s);
      g.rotateZ((r() - 0.5) * 0.35);
      g.rotateY(r() * Math.PI * 2);
      paintBrick(g, r, shade);
    } else {
      g = rustyPlateGeometry(r);
      const s = (0.3 + r() * 0.26) * size;
      g.scale(s, size, s);
      g.rotateY(r() * Math.PI * 2);
      // 얼룩덜룩해야 녹이다. 고른 갈색은 페인트다.
      scratchColor.set("#6b4b36");
      scratchColor2.set("#2b211a");
      bakeColors(g, null, (px, py, pz) => {
        const rust = positionNoise(px * 11, py * 11, pz * 11);
        const bare = Math.max(0, positionNoise(px * 4, 0, pz * 4) - 0.62) * 2.6;
        const c = scratchColor
          .clone()
          .lerp(scratchColor2, 0.15 + rust * 0.55)
          .lerp(BARE_STEEL, Math.min(0.6, bare));
        return [c.r * shade, c.g * shade, c.b * shade];
      });
    }

    // 밑면이 바닥판에 닿게 올린다. 벽 밑 물건은 벽에 바짝 붙여야 떨어져 나온 것으로 보인다.
    g.computeBoundingBox();
    const box = g.boundingBox ?? new THREE.Box3();
    const halfWidth = (box.max.x - box.min.x) * 0.5;
    const gx = againstWall ? (isLeftWall ? x0 + halfWidth + 0.04 + r() * 0.25 : x1 - halfWidth - 0.04 - r() * 0.25) : x;
    g.translate(gx, -box.min.y + floorY + 0.002, z);
    bucket.push(g);
  }

  return { cans: mergeAndDispose(cans), papers: mergeAndDispose(papers), others: mergeAndDispose(others) };
}

export interface PuddleSpot {
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** 떨어지는 주기 — 저마다 달라야 기계처럼 안 보인다 */
  period: number;
  offset: number;
}

/** 웅덩이 자리를 먼저 정한다 — 물방울이 그 웅덩이 위에서 떨어져야 한다. */
export function puddleSpots({
  x0,
  x1,
  z0,
  z1,
  count,
  seed,
}: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  count: number;
  seed: number;
}): PuddleSpot[] {
  const r = makeRandom(seed + 4242);
  return Array.from({ length: count }, () => ({
    x: x0 + (0.15 + r() * 0.7) * (x1 - x0),
    z: z0 + r() * (z1 - z0),
    sx: 0.9 + r() * 1.5,
    sz: 0.6 + r() * 1.1,
    period: 1.6 + r() * 2.2,
    offset: r() * 3,
  }));
}

/** 가장자리가 들쭉날쭉한 물웅덩이. 정원은 물이 아니라 스티커로 보인다. */
export function puddleGeometry({
  spots,
  seed,
  floorY,
  brightness,
}: {
  spots: PuddleSpot[];
  seed: number;
  floorY: number;
  brightness: BrightnessAt;
}) {
  const r = makeRandom(seed + 991);
  const pieces: THREE.BufferGeometry[] = [];
  for (const { x, z, sx, sz } of spots) {
    const g = new THREE.CircleGeometry(0.5, 20);
    const p = g.attributes.position;
    // 0번은 한가운데라 건드리지 않는다
    for (let i = 1; i < p.count; i++) {
      const k = 0.72 + 0.5 * positionNoise(p.getX(i) * 5 + r(), p.getY(i) * 5, 0);
      p.setXY(i, p.getX(i) * k, p.getY(i) * k);
    }
    p.needsUpdate = true;
    g.rotateX(-Math.PI / 2);
    g.scale(sx, 1, sz);
    g.translate(x, floorY + 0.01, z);
    const v = Math.max(0.1, brightness(z));
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      colors[i * 3] = 0.06 * v;
      colors[i * 3 + 1] = 0.075 * v;
      colors[i * 3 + 2] = 0.09 * v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pieces.push(g);
  }
  return mergeAndDispose(pieces);
}

// 채도를 낮춘 흙빛 녹. 주황빛이 세면 칠한 것으로 보이고 어두운 복도에서 그 부분만 튄다.
const RUST_TONES = ["#5c4133", "#67493a", "#4a382d", "#3a2d25"];

/** 반지름을 들쭉날쭉하게 흔든 얼룩 판 — 원판 그대로면 동그란 스티커다. */
function stainDisc(r: Random, { verticalStretch = 1 } = {}) {
  const g = new THREE.CircleGeometry(0.5, 16);
  const p = g.attributes.position;
  const seed = r() * 9;
  for (let i = 1; i < p.count; i++) {
    const k = 0.55 + 0.75 * positionNoise(p.getX(i) * 6 + seed, p.getY(i) * 6, seed);
    p.setXY(i, p.getX(i) * k, p.getY(i) * k * verticalStretch);
  }
  p.needsUpdate = true;
  return g;
}

/** 가운데는 녹, 가장자리는 바탕색 — 테두리 없이 스르륵 번져 보인다. */
function tintStain(g: THREE.BufferGeometry, rust: THREE.Color, base: THREE.Color, shade: number) {
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // 삼각부채라 0번이 중심, 나머지가 테두리다
    scratchColor
      .copy(rust)
      .lerp(base, i === 0 ? 0 : 1)
      .multiplyScalar(shade);
    colors[i * 3] = scratchColor.r;
    colors[i * 3 + 1] = scratchColor.g;
    colors[i * 3 + 2] = scratchColor.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/** 벽을 타고 내려간 균열. 마디마다 꺾이고 끝으로 갈수록 가늘어져야 갈라진 것으로 보인다. */
function crackPieces(r: Random, color: THREE.Color, shade: number) {
  const segments = 3 + Math.floor(r() * 3);
  const pieces: THREE.BufferGeometry[] = [];
  let x = 0;
  let y = 0;
  let angle = -Math.PI / 2 + (r() - 0.5) * 0.5;
  let thickness = 0.045 + r() * 0.03;
  for (let i = 0; i < segments; i++) {
    const length = 0.18 + r() * 0.3;
    const g = new THREE.PlaneGeometry(1, 1);
    g.scale(length, thickness, 1);
    g.rotateZ(angle);
    g.translate(x + (Math.cos(angle) * length) / 2, y + (Math.sin(angle) * length) / 2, 0);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      colors[k * 3] = color.r * shade;
      colors[k * 3 + 1] = color.g * shade;
      colors[k * 3 + 2] = color.b * shade;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pieces.push(g);
    x += Math.cos(angle) * length;
    y += Math.sin(angle) * length;
    angle += (r() - 0.5) * 0.9;
    thickness *= 0.72;
  }
  return pieces;
}

interface CorrosionOptions {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  floorY: number;
  wallHeight: number;
  counts: { floor: number; wall: number; crack: number };
  seed: number;
  brightness: BrightnessAt;
  floorColor: string;
  wallColor: string;
  doorZ: number;
  doorWidth: number;
  size: number;
}

/**
 * 바닥·벽 부식 자국. 고르게 낡은 면은 무늬 반복이 드러난다 — 물이 닿은 자리처럼 한 군데씩 썩어 들어가야 세월로 읽힌다.
 * 벽 자국은 물이 새 흘러내린 것이라 아래로 길게 끌린다.
 */
export function corrosionGeometry({
  x0,
  x1,
  z0,
  z1,
  floorY,
  wallHeight,
  counts,
  seed,
  brightness,
  floorColor,
  wallColor,
  doorZ,
  doorWidth,
  size,
}: CorrosionOptions) {
  const r = makeRandom(seed + 777);
  const pieces: THREE.BufferGeometry[] = [];
  const floorBase = new THREE.Color(floorColor);
  const wallBase = new THREE.Color(wallColor);
  const rust = new THREE.Color();

  // 바닥 — 벽 밑과 웅덩이 언저리가 먼저 썩는다
  for (let i = 0; i < counts.floor; i++) {
    const nearWall = r() < 0.75;
    const u = nearWall ? (r() < 0.5 ? 0.04 : 0.96) + (r() - 0.5) * 0.22 : 0.2 + r() * 0.6;
    const x = x0 + Math.min(0.99, Math.max(0.01, u)) * (x1 - x0);
    const z = z0 + r() * (z1 - z0);
    const g = stainDisc(r);
    g.rotateX(-Math.PI / 2);
    const s = (0.5 + r() * 1.5) * size;
    g.scale(s, 1, s * (0.7 + r() * 0.8));
    g.rotateY(r() * Math.PI);
    g.translate(x, floorY + 0.004, z);
    rust.set(RUST_TONES[Math.floor(r() * RUST_TONES.length)]);
    tintStain(g, rust, floorBase, Math.max(0.12, brightness(z)));
    pieces.push(g);
  }

  // 벽 — 물이 스며오르는 아래쪽에 몰리고 아래로 흘러내린다
  for (let i = 0; i < counts.wall; i++) {
    const isLeft = r() < 0.5;
    const z = z0 + r() * (z1 - z0);
    // 방으로 통하는 구멍 자리는 벽이 없다
    if (!isLeft && Math.abs(z - doorZ) < doorWidth / 2 + 0.3) continue;
    const isDrip = r() < 0.45;
    const g = stainDisc(r, { verticalStretch: isDrip ? 2.6 + r() * 2.2 : 1 });
    // 제곱하면 바닥 가까이로 쏠린다
    const h = Math.pow(r(), 1.8) * wallHeight * 0.7 + 0.15;
    const s = (0.45 + r() * 1.2) * size;
    g.scale(s, s, 1);
    // 흘러내린 자국은 아래로 끌리므로 중심을 위로 잡는다
    g.translate(0, isDrip ? -s * 0.6 : 0, 0);
    if (isLeft) {
      g.rotateY(Math.PI / 2);
      g.translate(x0 + 0.03, h, z);
    } else {
      g.rotateY(-Math.PI / 2);
      g.translate(x1 - 0.03, h, z);
    }
    rust.set(RUST_TONES[Math.floor(r() * RUST_TONES.length)]);
    tintStain(g, rust, wallBase, Math.max(0.12, brightness(z)));
    pieces.push(g);
  }

  // 금 — 얇아서 얼룩과 같이 벽에 눕는다
  const crackColor = new THREE.Color("#1e2024");
  for (let i = 0; i < counts.crack; i++) {
    const isLeft = r() < 0.5;
    const z = z0 + r() * (z1 - z0);
    if (!isLeft && Math.abs(z - doorZ) < doorWidth / 2 + 0.3) continue;
    const h = wallHeight * (0.35 + r() * 0.5);
    for (const g of crackPieces(r, crackColor, Math.max(0.12, brightness(z)))) {
      g.scale(size, size, 1);
      if (isLeft) {
        g.rotateY(Math.PI / 2);
        g.translate(x0 + 0.035, h, z);
      } else {
        g.rotateY(-Math.PI / 2);
        g.translate(x1 - 0.035, h, z);
      }
      pieces.push(g);
    }
  }

  return mergeAndDispose(pieces);
}
