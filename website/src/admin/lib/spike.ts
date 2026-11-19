/**
 * 평소(기준선)보다 크게 늘었는지. 작은 수가 1 → 3 처럼 출렁이는 것은 급증으로 보지 않는다.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */
export const SPIKE_RATIO = 2;
export const SPIKE_MIN_GAP = 5;

export function isSpike(value: number, baseline: number): boolean {
  return value - baseline >= SPIKE_MIN_GAP && value >= baseline * SPIKE_RATIO;
}

/** 기준선 대비 증감(%). 기준선이 0 이면 비율을 낼 수 없어 null. */
export function changePercent(value: number, baseline: number): number | null {
  return baseline > 0 ? ((value - baseline) / baseline) * 100 : null;
}
