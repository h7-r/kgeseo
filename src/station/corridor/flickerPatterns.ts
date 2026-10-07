export interface FlickerPattern {
  /** 반복 주기(초) */
  period: number;
  offset: number;
  /** 주기 안에서 꺼지는 [시작초, 지속초] 구간들 */
  offs: [number, number][];
}

/** 형광등 깜빡임 — 규칙적으로 반복된다. 한 번 툭 / 빠르게 두 번 / 세 번 연달아. */
export const FLICKER_PATTERNS: FlickerPattern[] = [
  { period: 6.2, offset: 0.0, offs: [[5.6, 0.09]] },
  {
    period: 4.7,
    offset: 1.9,
    offs: [
      [4.05, 0.07],
      [4.2, 0.05],
    ],
  },
  {
    period: 8.1,
    offset: 3.4,
    offs: [
      [7.1, 0.06],
      [7.22, 0.05],
      [7.33, 0.1],
    ],
  },
];
