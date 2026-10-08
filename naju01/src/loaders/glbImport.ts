// 밖에서 만들어 온 3D 파일을 이 공간의 규약(1 유닛 ≈ 0.3 m)에 맞춰 들인다.
// Meshy 같은 툴이 주는 모델은 크기가 제멋대로라, 바운딩 박스로 「실제 높이 몇 m」를 못 박은 뒤에 놓아야
// §3 의 「사람으로 보이는가」 판정이 무너지지 않는다. 지형처럼 이미 제자리에 있는 것은 정규화하지 않는다.

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { UNITS_PER_METER } from "../plan/sitePlan";

const loader = new GLTFLoader();

/** ArrayBuffer 에서 바로 읽는다 — 도구가 파일을 건네줄 때 쓴다. */
export function parseGlb(buffer: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => loader.parse(buffer, "", resolve, reject));
}

// instanceof 대신 is* 표식 — three 가 두 벌 실려도(도구·SSR) 메시를 알아본다
export const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true;

export function firstMesh(gltf: GLTF): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && !found) found = o;
  });
  return found;
}

type SizeBasis = "height" | "width" | "depth" | "max";

interface FitRealSizeOptions {
  basis?: SizeBasis;
  /** 그 축의 실제 길이(미터) */
  targetMeters: number;
  /** 밑면을 y = 0 에 둔다(땅에 심기 좋게). false 면 세로도 가운데 */
  alignBottom?: boolean;
}

/** 지오메트리를 실치수로 키우고, 가로는 한가운데 · 세로는 밑면을 원점에 둔다. */
export function fitRealSize(
  geometry: THREE.BufferGeometry,
  { basis = "height", targetMeters, alignBottom = true }: FitRealSizeOptions,
): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  if (!b) return geometry;
  const width = b.max.x - b.min.x;
  const height = b.max.y - b.min.y;
  const depth = b.max.z - b.min.z;
  const sizes: Record<SizeBasis, number> = { width, height, depth, max: Math.max(width, height, depth) };
  const current = sizes[basis];
  // 납작하거나 빈 것은 그냥 둔다
  if (!(current > 0)) return geometry;
  const factor = (targetMeters * UNITS_PER_METER) / current;
  geometry.scale(factor, factor, factor);
  geometry.computeBoundingBox();
  const c = geometry.boundingBox;
  if (!c) return geometry;
  geometry.translate(
    -(c.max.x + c.min.x) / 2,
    alignBottom ? -c.min.y : -(c.max.y + c.min.y) / 2,
    -(c.max.z + c.min.z) / 2,
  );
  return geometry;
}
