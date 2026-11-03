/** 꼭짓점 색으로 칠한 조각 — 능선 소품(수레 · 궤 · 함 · 열쇠 · 새)은 재질 하나에 색을 꼭짓점에 둔다 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { TOON_GRADIENT } from "@/engine/toon";

/** 합칠 수 있게 평평하게 — 인덱스를 풀고 uv 를 버리고 법선을 보장한다 */
export function flattenGeometry(geometry: THREE.BufferGeometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute("uv");
  if (!flat.attributes.normal) flat.computeVertexNormals();
  return flat;
}

/** 한 색으로 칠한다 */
export function paintGeometry(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const flat = flattenGeometry(geometry);
  const tint = new THREE.Color(color);
  const colors = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

/** 칠한 상자 — 크기와 가운데 자리 */
export const paintedBox = (
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
) => paintGeometry(new THREE.BoxGeometry(width, height, depth).translate(x, y, z), color);

export const mergeParts = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts, false)!;

export const makeVertexColorMaterial = (extra: Partial<THREE.MeshToonMaterialParameters> = {}) =>
  new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: TOON_GRADIENT, ...extra });
