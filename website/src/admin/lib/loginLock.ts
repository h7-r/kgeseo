/**
 * 로그인 잠김(429 login_locked)의 남은 시간 안내. 서버는 잠금이 풀릴 때까지 남은 초를 Retry-After 에 정수로 준다.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

/** Retry-After 를 초로. 양의 정수만 받는다 — 비었거나 날짜 · 소수 · 음수 · 글자면 undefined. */
export function parseRetryAfter(raw: string | null | undefined): number | undefined {
  const value = raw?.trim() ?? "";
  if (!/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > 0 && Number.isSafeInteger(seconds) ? seconds : undefined;
}

/** 헤더가 없거나 이상할 때 쓰는 원래 문구. */
export const LOCKED_FALLBACK = "로그인을 여러 번 틀려 잠시 잠겼습니다. 잠시 뒤에 다시 시도해 주세요.";

/** 남은 시간을 분으로 올려 알린다. 1분 미만은 「잠시 뒤」. */
export function lockedLoginMessage(seconds: number | undefined): string {
  if (seconds === undefined || !(seconds > 0)) return LOCKED_FALLBACK;
  const when = seconds < 60 ? "잠시 뒤" : `${Math.ceil(seconds / 60)}분 뒤`;
  return `로그인이 잠시 막혔습니다. ${when} 다시 시도해 주세요.`;
}
