export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** from~to 구간에서 시작·끝 속도가 0 인 0~1 비율. 구간 밖은 0 또는 1. */
export function smoothstep(from: number, to: number, x: number): number {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
}

/** 처음 빠르고 끝에서 부드럽게 멈추는 보간 비율. */
export function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}
