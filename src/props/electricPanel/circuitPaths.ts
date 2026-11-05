/** 소화전 밑 전선관 두 줄의 길 — 함이 재서 넣어 주고 회로 연출이 읽는다 */
import type * as THREE from "three";

let conduitPaths: THREE.Curve<THREE.Vector3>[] = [];

export const setConduitPaths = (paths: THREE.Curve<THREE.Vector3>[]) => {
  conduitPaths = paths;
};
export const getConduitPaths = () => conduitPaths;

/** 자판기 문이 열릴 때 화면이 서는 자리 · 바라보는 곳 · 밀리는 시간(초) — 복도 구역이 재서 넣어 준다 */
export const vendingFocus: { position: THREE.Vector3Tuple; target: THREE.Vector3Tuple; pushSeconds: number } = {
  position: [0, 0, 0],
  target: [0, 0, 0],
  pushSeconds: 2.2,
};
