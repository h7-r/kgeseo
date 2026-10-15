export const HOVER_CONFIG = {
  baseHeight: 1.3, // 바닥 기준 높이 (m)
  amplitude: 0.08, // 상하 진폭 (m)
  period: 2.4, // 주기 (s)
} as const

// 부유 애니메이션의 세로 오프셋. 추적 위치와 분리해 렌더링 시에만 더한다.
export function hoverOffset(elapsedSeconds: number): number {
  return (
    HOVER_CONFIG.amplitude *
    Math.sin((2 * Math.PI * elapsedSeconds) / HOVER_CONFIG.period)
  )
}
