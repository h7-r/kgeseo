/**
 * 「안전한 곳으로 이동」의 자리 고르기 — 순수 함수(별칭 · three 없이, node --test). 구역 판정과 자리 표는 safeSpot 이 넘긴다.
 * 같은 구역 · 안 막힘 · 지금 자리에서 minMove 넘게 떨어진 첫 자리. 다 가까우면 안 막힌 첫 자리(끼인 자리 곁이라도 다시 세운다),
 * 다 막혔으면 null(억지로 보내지 않는다 — 자리 다시 잡기 01회차 Codex).
 */
export type SpotHeading = "+X" | "-X" | "+Z" | "-Z";

export interface SafeSpot {
  x: number;
  z: number;
  heading: SpotHeading;
}

export function pickSafeSpot<Zone extends string>(
  from: { x: number; z: number },
  candidates: readonly SafeSpot[],
  zoneOf: (x: number, z: number) => Zone,
  isBlocked: (x: number, z: number) => boolean,
  minMove: number,
): SafeSpot | null {
  const zone = zoneOf(from.x, from.z);
  const usable = candidates.filter((spot) => zoneOf(spot.x, spot.z) === zone && !isBlocked(spot.x, spot.z));
  return usable.find((spot) => Math.hypot(spot.x - from.x, spot.z - from.z) > minMove) ?? usable[0] ?? null;
}
