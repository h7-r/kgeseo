// 씬 소품과 world/props 표본을 깎는 공용 부품.
// 조각마다 꼭짓점에 진짜 색을 굽고 하나로 합친 뒤 높이 1 · 밑동 원점으로 맞춘다.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { applyBaseOrigin, type Spot } from "../placement/instanceGroups";
import { applyVertexColors, type HeightAt } from "../terrain/ground";

export interface SceneSpotOptions {
  heightAt?: HeightAt | null;
}

/** 화면 위 풀이 한 줄. Leva 라벨을 끄면 같이 사라진다. */
export interface SceneNote {
  text: string;
  color: string;
}

// y 는 안 적는다 — 지면에서 다시 잰다
export function placeOnGround(heightAt: HeightAt | null | undefined, spots: Omit<Spot, "y">[]): Spot[] {
  return spots.map((spot) => ({ ...spot, y: heightAt ? heightAt(spot.x, spot.z) : 0 }));
}

/** 인덱스를 풀고 받은 지오는 버린다 — 정이십면체(처음부터 인덱스 없음)와 합치려면 형식이 같아야 한다. */
export function unindex(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
}

// mergeGeometries 는 속성 구성이 다르면 조용히 null 을 낸다 — uv 를 떼어 형식을 맞춘다
export function prepareForMerge(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = unindex(geometry);
  flat.deleteAttribute("uv");
  flat.deleteAttribute("uv1");
  return flat;
}

export const buildBox = (width: number, height: number, depth: number) =>
  prepareForMerge(new THREE.BoxGeometry(width, height, depth));

export const buildCylinder = (radiusTop: number, radiusBottom: number, height: number, segments = 6) =>
  prepareForMerge(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1));

// 정이십면체는 처음부터 인덱스가 없다
export const buildBall = (radius: number, detail = 0) => {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  geometry.deleteAttribute("uv");
  return geometry;
};

export const buildRing = (radius: number, tube: number, segments = 10) =>
  prepareForMerge(new THREE.TorusGeometry(radius, tube, 4, segments));

export const applyColor = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) =>
  applyVertexColors(geometry, new THREE.Color(color));

export function mergePieces(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((piece) => piece.dispose());
  return applyBaseOrigin(merged);
}
