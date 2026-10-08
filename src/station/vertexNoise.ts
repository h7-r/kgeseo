import * as THREE from "three";

import { makeRandom } from "@/engine/random";

// 기준 1.19 = 캐비닛 본체의 대각선. 본체(높이 1)와 서랍 앞판(높이 0.22)이 같은 값으로 같은 만큼 낡아 보이게 크기에 비례시킨다.
const CABINET_DIAGONAL = 1.19;

function sizeOf(geometry: THREE.BufferGeometry): { box: THREE.Box3; size: THREE.Vector3 } {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const size = new THREE.Vector3();
  box.getSize(size);
  return { box, size };
}

/**
 * 움푹 파인 자국 — 정점을 법선 반대쪽으로 밀어 넣는다.
 * radius 는 자국 하나의 크기(대각선 대비). 작은 부품은 크게 잡아야 눌린 게 보인다.
 */
export function dentGeometry(
  geometry: THREE.BufferGeometry,
  seed: number,
  count: number,
  depth: number,
  radius = 0.05,
) {
  // cabinet.glb 에는 NORMAL 속성이 없다.
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const rnd = makeRandom(seed);
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const n = geometry.attributes.position.count;

  const { box, size } = sizeOf(geometry);
  const scale = size.length() / CABINET_DIAGONAL;

  // 모서리를 찌그러뜨리면 상자 형태가 무너진다 — 평평한 패널의 높이 15~90% 구간에만 찍는다.
  const minY = box.min.y + size.y * 0.15;
  const maxY = box.min.y + size.y * 0.9;
  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    const nx = Math.abs(normals[i * 3]);
    const nz = Math.abs(normals[i * 3 + 2]);
    const y = positions[i * 3 + 1];
    if ((nx > 0.85 || nz > 0.85) && y > minY && y < maxY) candidates.push(i);
  }
  if (!candidates.length) return;

  for (let k = 0; k < count; k++) {
    const c = candidates[Math.floor(rnd() * candidates.length)] * 3;
    const cx = positions[c];
    const cy = positions[c + 1];
    const cz = positions[c + 2];
    const r = scale * (radius + rnd() * radius);
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(positions[i * 3] - cx, positions[i * 3 + 1] - cy, positions[i * 3 + 2] - cz);
      if (d >= r) continue;
      const t = 1 - d / r;
      const s = t * t * (3 - 2 * t) * depth * scale;
      positions[i * 3] -= normals[i * 3] * s;
      positions[i * 3 + 1] -= normals[i * 3 + 1] * s;
      positions[i * 3 + 2] -= normals[i * 3 + 2] * s;
    }
  }
  geometry.attributes.position.needsUpdate = true;
}

/**
 * 면을 법선 방향으로 아주 조금씩 흔든다.
 * 코드로 만든 상자는 완벽한 평면이라 툰 명암 한 칸에 통째로 들어가, GLB 몸통 옆에서 혼자 매끈해 보인다.
 */
export function jitterGeometry(geometry: THREE.BufferGeometry, seed: number, strength: number) {
  if (strength <= 0) return;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const rnd = makeRandom(seed + 4441);
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const { size } = sizeOf(geometry);
  const amount = size.length() * strength;
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const s = (rnd() - 0.5) * amount;
    positions[i * 3] += normals[i * 3] * s;
    positions[i * 3 + 1] += normals[i * 3 + 1] * s;
    positions[i * 3 + 2] += normals[i * 3 + 2] * s;
  }
  geometry.attributes.position.needsUpdate = true;
  // 흔든 뒤 법선을 다시 잡아야 면이 각지게 보인다.
  geometry.computeVertexNormals();
}

/**
 * 얼룩을 정점 색으로 칠한다(UV 없이 툰 색에 곱해진다).
 * yOffset 은 이 지오가 캐비닛 안에서 놓이는 높이 — 부품도 바닥에 가까울수록 때가 타게 한다.
 */
export function stainGeometry(
  geometry: THREE.BufferGeometry,
  seed: number,
  count: number,
  strength: number,
  yOffset = 0,
) {
  const rnd = makeRandom(seed + 9973);
  const positions = geometry.attributes.position.array;
  const n = geometry.attributes.position.count;
  const dark = new Float32Array(n);
  const { size } = sizeOf(geometry);
  const scale = size.length() / CABINET_DIAGONAL;

  for (let k = 0; k < count; k++) {
    const c = Math.floor(rnd() * n) * 3;
    const cx = positions[c];
    const cy = positions[c + 1];
    const cz = positions[c + 2];
    const r = scale * (0.1 + rnd() * 0.24);
    const s = 0.4 + rnd() * 0.7;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(positions[i * 3] - cx, positions[i * 3 + 1] - cy, positions[i * 3 + 2] - cz);
      if (d >= r) continue;
      const t = 1 - d / r;
      dark[i] += t * t * s;
    }
  }
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    dark[i] += Math.max(0, 0.16 - (positions[i * 3 + 1] + yOffset)) * 2.4;
    const f = 1 - Math.min(0.5, dark[i] * strength);
    colors[i * 3] = f;
    colors[i * 3 + 1] = f * 0.985;
    // 살짝 누렇게
    colors[i * 3 + 2] = f * 0.95;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

interface SurfaceStainOptions {
  /** 얼룩 개수 */
  count?: number;
  /** 얼룩 진하기. 아무리 겹쳐도 40% 까지만 어두워진다 */
  strength?: number;
  /** 1보다 크면 세로로 늘어나 흘러내린 자국이 된다 */
  verticalStretch?: number;
  /** 이 높이 아래로 갈수록 때가 탄다(벽만). 0 이면 끈다 */
  bottomGrime?: number;
  /** 지오 로컬 y 를 월드 높이로 바꿀 때 더하는 값 */
  heightOffset?: number;
}

/**
 * 면 한 장에 딱 한 번만 생기는 큰 얼룩을 정점 색으로 칠한다.
 * 텍스처는 몇 유닛마다 되풀이돼 무늬가 눈에 띈다 — 이 얼룩이 반복을 깨 준다. UV 가 없어도 되고 toon 색에 그대로 곱해진다.
 */
export function applySurfaceStains(
  geometry: THREE.BufferGeometry,
  seed: number,
  { count = 16, strength = 0.5, verticalStretch = 1, bottomGrime = 0, heightOffset = 0 }: SurfaceStainOptions = {},
) {
  const rnd = makeRandom(seed + 777);
  const position = geometry.attributes.position;
  const n = position.count;
  const dark = new Float32Array(n);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return;
  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;

  for (let k = 0; k < count; k++) {
    const cx = bounds.min.x + rnd() * width;
    const cy = bounds.min.y + rnd() * height;
    const radius = width * (0.03 + rnd() * 0.1);
    const intensity = 0.3 + rnd() * 0.8;
    for (let i = 0; i < n; i++) {
      const dx = position.getX(i) - cx;
      const dy = (position.getY(i) - cy) / verticalStretch;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      const t = 1 - d / radius;
      dark[i] += t * t * intensity;
    }
  }

  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (bottomGrime) {
      const worldY = position.getY(i) + heightOffset;
      dark[i] += Math.max(0, 1 - worldY / bottomGrime) * 1.1;
    }
    const f = 1 - Math.min(0.4, dark[i] * strength);
    colors[i * 3] = f;
    colors[i * 3 + 1] = f * 0.995;
    colors[i * 3 + 2] = f * 0.985; // 아주 살짝 누렇게
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}
