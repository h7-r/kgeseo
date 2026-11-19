// 터치 조작 화면(TouchHud)의 단추 자리 — 다른 HUD 가 빈칸을 잴 때 같은 값을 쓴다

/**
 * 단추 자리 — 게임 화면 안쪽을 덜 덮게 가장자리로 붙였다(11/8 해랑 검토 「단추 · 안내가 화면 안쪽을 많이 차지」).
 * 누르는 칸은 44px 이상(Apple HIG). 다른 HUD(나주 빠른 칸 · 숨 · 당김 게이지)가 이 값으로 빈칸을 잰다.
 */
export const TOUCH_HUD = {
  /** 위 단추 줄 · 오른쪽 아래 묶음과 화면(안전 영역) 사이 */
  edge: 8,
  /** 위 단추 줄 단추 한 변 */
  topButton: 44,
  /** 위 단추 줄 단추 사이 */
  topGap: 6,
  /** 오른쪽 아래 동작 묶음(앉기 · 점프 · ✋)의 오른쪽 여백 · 폭 · 아래 여백 */
  actionRight: 12,
  actionWidth: 150,
  actionBottom: 10,
  /** 왼쪽 이 비율까지가 이동 스틱 자리 */
  stickArea: 0.4,
} as const;
/** 위 단추 줄의 폭(단추 n 개) — 오른쪽 안전 영역 · 가장자리 여백은 뺀 값 */
export const topRowWidth = (count: number) => count * TOUCH_HUD.topButton + (count - 1) * TOUCH_HUD.topGap;
