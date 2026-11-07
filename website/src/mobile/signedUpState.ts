/**
 * 휴대폰에서 가입을 막 마치고 홈으로 온 표시(라우터 state) — 홈이 한 번 안내한다(11/7 미르).
 * 가입 직후엔 게임으로 바로 넘기지 않는다. 가로로 돌리고 「플레이하기」를 직접 누르게 한다.
 */
export const SIGNED_UP_STATE = { justSignedUp: true } as const;

export function isSignedUpState(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { justSignedUp?: unknown }).justSignedUp === true;
}
