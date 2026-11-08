// 밑창 후보 정점 줄이기 — 로비 버벅임(2026-11-07, 검토 12회차).
// 한 뼈에 통째로(가중치 1) 묶이고 위치 모프가 없는 메시는, 스키닝·배치가 어떻게 바뀌어도 정점 전체에 같은 아핀 변환이
// 걸린다. 아핀 변환 뒤 가장 낮은 점은 언제나 볼록 껍질 꼭짓점 중 하나이므로, 껍질 꼭짓점만 남겨도 최저점은 같다.
// 신발이 그렇다(meshy_fit_shoe.py 가 발뼈 하나에 100% 묶고 모프 없이 내보낸다). 남자 기본 신발 후보 4,372 → 약 1,122.
import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

type PositionAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** 후보 정점이 모두 같은 뼈 하나에 가중치 1로 묶였고 위치 모프가 없을 때만 true — 이때만 껍질로 줄여도 결과가 같다. */
export function isRigidlySkinned(geometry: THREE.BufferGeometry, indices: readonly number[]): boolean {
  if ((geometry.morphAttributes.position?.length ?? 0) > 0) return false;
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (!skinIndex || !skinWeight || indices.length === 0) return false;
  let bone = -1;
  for (const i of indices) {
    let found = -1;
    for (let k = 0; k < skinWeight.itemSize; k += 1) {
      const weight = skinWeight.getComponent(i, k);
      if (weight === 0) continue;
      // 0 이 아닌 가중치가 둘 이상이거나 1 이 아니면 정점마다 변환이 달라진다
      if (found !== -1 || Math.abs(weight - 1) > 1e-6) return false;
      found = skinIndex.getComponent(i, k);
    }
    if (found === -1) return false;
    if (bone === -1) bone = found;
    else if (found !== bone) return false;
  }
  return true;
}

// 껍질이 제대로 나왔는지 보는 방향들(구 위에 고르게). 방향마다 「가장 먼 점」이 전체와 껍질에서 같아야 한다.
const CHECK_DIRECTIONS = Array.from({ length: 64 }, (_, k) => {
  const y = 1 - (2 * (k + 0.5)) / 64;
  const r = Math.sqrt(1 - y * y);
  const a = k * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
});

/**
 * 후보 중 볼록 껍질 꼭짓점만(원래 순서대로). 껍질을 못 믿으면(점이 적음·납작함·검사 실패) 원래 목록을 그대로 돌려준다.
 * isRigidlySkinned 가 참인 메시에만 쓴다.
 */
export function hullIndices(position: PositionAttribute, indices: readonly number[]): readonly number[] {
  if (indices.length < 8) return indices;
  const points = indices.map((i) => new THREE.Vector3().fromBufferAttribute(position, i));
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  // 한 축이 거의 0 이면(평면) 껍질 계산이 가장자리 점을 버릴 수 있다
  if (Math.min(size.x, size.y, size.z) < 1e-5) return indices;
  let hull: ConvexHull;
  try {
    hull = new ConvexHull().setFromPoints(points);
  } catch {
    return indices;
  }
  const owner = new Map(points.map((point, k) => [point, indices[k]]));
  const kept = new Set<number>();
  hull.faces.forEach((face) => {
    for (let e = 0; e < 3; e += 1) {
      const index = owner.get(face.getEdge(e).head().point);
      if (index !== undefined) kept.add(index);
    }
  });
  if (kept.size < 4) return indices;
  const result = indices.filter((i) => kept.has(i));
  const keptPoints = points.filter((_, k) => kept.has(indices[k]));
  const reach = (list: THREE.Vector3[], direction: THREE.Vector3) =>
    list.reduce((best, point) => Math.max(best, point.dot(direction)), -Infinity);
  const tolerance = 1e-9 * Math.max(size.x, size.y, size.z, 1);
  for (const direction of CHECK_DIRECTIONS) {
    if (reach(points, direction) - reach(keptPoints, direction) > tolerance) return indices;
  }
  return result;
}
