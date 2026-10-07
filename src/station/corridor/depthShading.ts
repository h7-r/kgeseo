/**
 * 복도 깊이 감광. 벽·배관·문·소품이 같은 규칙으로 어두워져야 따로 노는 느낌이 안 난다.
 * 이 씬의 어둠은 조명이 아니라 정점색·재질색에 곱하는 배수다 — 폐역 전역 조명이 벽을 다 비추므로
 * 등을 끄는 것만으로는 어두워지지 않는다. 셀 셰이딩 단계도 안 깨진다.
 */
export interface CorridorDepthRule {
  /** 방으로 통하는 구멍 z. 여기서 멀어질수록 어둡다(양쪽 다). */
  doorZ: number;
  /** 이 거리만큼 멀어지면 감광이 최대 */
  falloff: number;
  darkness: number;
  /** 아무리 멀어도 이 아래로는 안 어두워진다. 어둠은 분위기지 정보를 지우는 게 아니다. */
  minBrightness: number;
  /** 비상계단(복도 끝 z0) 쪽만 한 번 더 어둡게 — 사람 눈은 멀수록 어둡다를 거리로 읽는다 */
  endDarkness: number;
  /** 1 보다 크면 문 근처는 그대로 두고 끝에 가까워질 때만 급히 어두워진다 */
  endCurve: number;
  z0: number;
  /** 작업등 퍼즐 구간 어둠 — 이 z 보다 안쪽(작은 z)은 darkFactor 배 */
  darkBoundary?: number;
  darkFactor?: number;
  /** 이 z 보다 안쪽은 비상 전원으로 이미 밝다 */
  brightBoundary?: number;
}

/** z 자리의 밝기 배수(0~1). */
export function corridorDepthBrightness(z: number, rule: CorridorDepthRule): number {
  const t = Math.min(1, Math.abs(z - rule.doorZ) / Math.max(1, rule.falloff));
  let b = Math.max(rule.minBrightness, 1 - rule.darkness * t);
  if (rule.endDarkness > 0 && z < rule.doorZ) {
    const toEnd = Math.max(1, rule.doorZ - rule.z0);
    const u = Math.min(1, (rule.doorZ - z) / toEnd); // 0 = 문 앞, 1 = 복도 끝
    b *= 1 - rule.endDarkness * Math.pow(u, rule.endCurve);
  }
  const { darkBoundary, darkFactor, brightBoundary } = rule;
  if (darkBoundary !== undefined && Number.isFinite(darkBoundary) && darkFactor !== undefined && darkFactor < 1) {
    // 4 유닛에 걸쳐 스르르 넘어가야 경계선이 안 보인다
    let w = Math.min(1, Math.max(0, (darkBoundary - z) / 4));
    if (brightBoundary !== undefined && Number.isFinite(brightBoundary))
      w *= Math.min(1, Math.max(0, (z - brightBoundary) / 4));
    b *= 1 - w * (1 - darkFactor);
  }
  return b;
}
