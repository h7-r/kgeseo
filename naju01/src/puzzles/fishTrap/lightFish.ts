/** 빛 물고기 — 그날 밤 꺼진 화톳불의 불티. 통발 · 소지품 · 화톳불이 같은 모양과 색을 쓴다 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const EMBER = new THREE.Color("#FFA24A");

/** 몸통 + 꼬리지느러미. 미터, 머리가 +z */
export function buildFishGeometry() {
  const body = new THREE.SphereGeometry(1, 12, 8);
  body.scale(0.045, 0.032, 0.11);
  const tail = new THREE.ConeGeometry(0.055, 0.09, 4, 1);
  tail.rotateX(Math.PI / 2);
  tail.scale(1, 0.25, 1);
  tail.translate(0, 0, -0.14);
  const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
  const merged = mergeGeometries([flat(body), flat(tail)], false)!;
  body.dispose();
  tail.dispose();
  return merged;
}
