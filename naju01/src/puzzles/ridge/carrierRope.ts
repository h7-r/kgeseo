/** 지게 밧줄 — 다리와 기둥에 감은 바퀴, 늘어진 줄. 단위는 미터, 그리는 것은 유닛(M 배) */
import * as THREE from "three";

import { M, groundY } from "../units";

export const ropeMaterial = new THREE.MeshStandardMaterial({ color: "#B9A472", roughness: 0.9 });
/** 밧줄 굵기(반지름 m) · 다리와 기둥에 감은 바퀴 수 */
export const ROPE_RADIUS = 0.012;
export const LEG_WRAPS = 3;
export const POLE_WRAPS = 4;

const UP = new THREE.Vector3(0, 1, 0);

/** 감긴 밧줄 — 축(+z) 둘레로 radius 만큼 떨어져 도는 고리 count 개를 gap 간격으로. 매듭 혹 하나를 곁들인다(유닛) */
export function buildRopeWraps(radius: number, count: number, gap: number) {
  const pieces: THREE.Mesh[] = [];
  for (let k = 0; k < count; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * M, ROPE_RADIUS * M, 6, 18), ropeMaterial);
    // 고리는 xy 판 — 축을 따라 쌓고 조금씩 비스듬히 감는다
    ring.position.z = (k - (count - 1) / 2) * gap * M;
    ring.rotation.set((k % 2 ? 1 : -1) * 0.12, 0.08, 0);
    ring.castShadow = true;
    pieces.push(ring);
  }
  const knot = new THREE.Mesh(new THREE.IcosahedronGeometry(ROPE_RADIUS * 2.1 * M, 1), ropeMaterial);
  knot.position.set((radius + ROPE_RADIUS) * M, 0, 0);
  knot.scale.set(1, 0.8, 1.3);
  knot.castShadow = true;
  pieces.push(knot);
  const group = new THREE.Group();
  group.add(...pieces);
  return group;
}

/** 지게 다리 하나의 끝 — 가장 낮은 꼭짓점들 중 한쪽 무리, 그 다리가 위로 뻗는 쪽, 다리 굵기(유닛, 지게 자기 좌표) */
export function findLegTip(parts: THREE.Mesh[]) {
  const points: THREE.Vector3[] = [];
  const vertex = new THREE.Vector3();
  for (const part of parts) {
    const position = part.geometry.attributes.position;
    const step = Math.max(1, Math.floor(position.count / 4000));
    for (let i = 0; i < position.count; i += step)
      points.push(vertex.fromBufferAttribute(position, i).multiply(part.scale).clone());
  }
  if (!points.length) return null;
  const box = new THREE.Box3().setFromPoints(points);
  // 다리 끝 — 바닥에서 5 cm 안의 꼭짓점 중 가장 왼쪽(−x) 것과 그 곁만. 받침 작대기 끝은 가운데 앞이라 섞이지 않는다
  const average = (list: THREE.Vector3[]) =>
    list.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
  const bottom = points.filter((point) => point.y < box.min.y + 0.05 * M);
  if (!bottom.length) return null;
  const leftmost = bottom.reduce((a, b) => (b.x < a.x ? b : a));
  const low = bottom.filter((point) => Math.hypot(point.x - leftmost.x, point.z - leftmost.z) < 0.07 * M);
  const tip = average(low);
  // 다리 결 — 20 cm 위의 같은 다리 단면
  const high = points.filter(
    (point) =>
      Math.abs(point.y - (box.min.y + 0.2 * M)) < 0.03 * M && Math.hypot(point.x - tip.x, point.z - tip.z) < 0.25 * M,
  );
  const axis = high.length ? average(high).sub(tip).normalize() : UP.clone();
  const thickness = low.reduce((r, point) => Math.max(r, Math.hypot(point.x - tip.x, point.z - tip.z)), 0) / M;
  return { tip, axis, radius: THREE.MathUtils.clamp(thickness, 0.018, 0.045) };
}

/** 늘어진 밧줄 — 가운데가 sag(m)만큼 처지되 땅을 파고들지 않고 땅 위에 눕는다(유닛) */
export function buildRopeCurve(from: THREE.Vector3, to: THREE.Vector3, sag: number) {
  const points: THREE.Vector3[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = from.clone().lerp(to, t);
    point.y -= sag * 4 * t * (1 - t) * M;
    point.y = Math.max(point.y, (groundY(point.x / M, point.z / M) + ROPE_RADIUS) * M);
    points.push(point);
  }
  return new THREE.CatmullRomCurve3(points);
}
