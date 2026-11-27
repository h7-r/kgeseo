/** 탈퇴를 막 마치고 홈으로 온 표시(라우터 state) — 홈 위에 작별 안내(WithdrawnNotice)를 한 번 띄운다. */
export const WITHDRAWN_STATE = { justWithdrawn: true } as const;

export function isWithdrawnState(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { justWithdrawn?: unknown }).justWithdrawn === true;
}
