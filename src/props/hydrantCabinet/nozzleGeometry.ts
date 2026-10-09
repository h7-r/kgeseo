import * as THREE from "three";

/**
 * 관창 한 자루의 위아래. 옆선·노란 끝·배전반 꽂는 자리가 모두 이 값을 본다.
 * +y = 노란 관창 끝(물줄기가 나오는 데 · 배전반 구멍에 꽂히는 쪽), −y = 호스가 물리는 커플링.
 */
export const NOZZLE_DIMENSIONS = {
  /** 원점 → 노란 관창 끝(+y) */
  tip: 0.3,
  /** 원점 → 호스 물리는 밑끝(−y) */
  hose: 0.3,
  /** 물 나오는 끝의 반지름 — 배전반 구멍 지름의 근거 */
  tipRadius: 0.032,
  /** 이 높이부터 위가 노란 관창 끝이다 */
  brassStart: 0.2,
} as const;

let cachedGeometry: THREE.BufferGeometry | null = null;

/**
 * 관창 몸통. 함 속·손·배전반 세 군데가 같은 지오를 보므로 한 번만 만들고 dispose 하지 않는다.
 * 길고 가늘어야 관창으로 읽힌다 — 아래가 굵고(커플링) 위로 갈수록 가늘다(물 나오는 끝).
 */
export function buildNozzleGeometry(): THREE.BufferGeometry {
  if (cachedGeometry) return cachedGeometry;
  const profile: [number, number][] = [
    [0.0, -NOZZLE_DIMENSIONS.hose],
    [0.056, -NOZZLE_DIMENSIONS.hose], // 커플링 — 호스보다 조금만 굵다
    [0.056, -0.25],
    [0.05, -0.21],
    [0.058, -0.1], // 몸통
    [0.055, 0.02],
    [0.04, 0.12], // 잘록한 목
    [0.043, NOZZLE_DIMENSIONS.brassStart],
    [0.038, 0.27],
    [NOZZLE_DIMENSIONS.tipRadius, NOZZLE_DIMENSIONS.tip],
    [0.0, NOZZLE_DIMENSIONS.tip],
  ];
  const lathe = new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(radius, y)),
    14,
  );
  cachedGeometry = lathe.toNonIndexed();
  lathe.dispose();
  return cachedGeometry;
}
