import * as THREE from "three";

import { makeRandom } from "@/engine/random";

const stoneCache = new Map<string, THREE.BufferGeometry>();

/**
 * 울퉁불퉁한 깨진 돌. 2×2×2 로 쪼갠 상자의 정점을 무작위로 민다.
 * 상자는 면끼리 정점을 공유하므로 같은 자리 정점은 같은 양만큼 밀어야 모서리가 안 벌어진다.
 * flatShading 과 짝이 되도록 toNonIndexed() 로 면마다 법선을 끊는다.
 */
export function stoneGeometry(seed: number, roughness = 0.3): THREE.BufferGeometry {
  const key = `${seed}|${roughness}`;
  const cached = stoneCache.get(key);
  if (cached) return cached;

  const base = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  const position = base.attributes.position;
  const rnd = makeRandom(seed);
  const offsets = new Map<string, [number, number, number]>();
  for (let i = 0; i < position.count; i++) {
    const k = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
    let d = offsets.get(k);
    if (!d) {
      d = [(rnd() - 0.5) * roughness, (rnd() - 0.5) * roughness, (rnd() - 0.5) * roughness];
      offsets.set(k, d);
    }
    position.setXYZ(i, position.getX(i) + d[0], position.getY(i) + d[1], position.getZ(i) + d[2]);
  }
  const geometry = base.toNonIndexed();
  geometry.computeVertexNormals();
  base.dispose();
  stoneCache.set(key, geometry);
  return geometry;
}
