// 씬 소품 조각을 깎는 공용 부품(소품.js 와 같은 규약).
// 조각마다 꼭짓점에 진짜 색을 굽고 하나로 합친 뒤 높이 1 · 밑동 원점으로 맞춘다.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { toBaseOrigin, type Spot } from "../placement/instanceGroups";
import { applyVertexColors } from "../terrain/ground";

export type GroundHeight = (x: number, z: number) => number;

export interface SceneSpotOptions {
  groundHeight?: GroundHeight | null;
}

/** 화면 위 풀이 한 줄. Leva 라벨을 끄면 같이 사라진다. */
export interface SceneNote {
  text: string;
  color: string;
}

// y 는 안 적는다 — 지면에서 다시 잰다
export function placeOnGround(groundHeight: GroundHeight | null | undefined, spots: Omit<Spot, "y">[]): Spot[] {
  return spots.map((spot) => ({ ...spot, y: groundHeight ? groundHeight(spot.x, spot.z) : 0 }));
}

// mergeGeometries 는 속성 구성이 다르면 조용히 null 을 낸다 — uv 를 떼어 형식을 맞춘다
export function flatten(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.toNonIndexed();
  flat.deleteAttribute("uv");
  flat.deleteAttribute("uv1");
  geometry.dispose();
  return flat;
}

export const box = (width: number, height: number, depth: number) =>
  flatten(new THREE.BoxGeometry(width, height, depth));

export const cylinder = (radiusTop: number, radiusBottom: number, height: number, segments = 6) =>
  flatten(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1));

// 정이십면체는 처음부터 인덱스가 없다
export const ball = (radius: number, detail = 0) => {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  geometry.deleteAttribute("uv");
  return geometry;
};

export const ring = (radius: number, tube: number, segments = 10) =>
  flatten(new THREE.TorusGeometry(radius, tube, 4, segments));

export const paint = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) =>
  applyVertexColors(geometry, new THREE.Color(color));

export function bundle(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((piece) => piece.dispose());
  return toBaseOrigin(merged);
}
