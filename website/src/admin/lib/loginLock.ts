/**
 * 관리자 로그인 잠김(429 login_locked) 문구. 남은 초는 웹과 같은 parseRetryAfter(lib/retryAfter.ts)로 읽는다.
 * 문구는 웹과 다르다 — 1분 미만은 초를 말하지 않고 「잠시 뒤」.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

/** 헤더가 없거나 이상할 때 쓰는 원래 문구. */
export const LOCKED_FALLBACK = "로그인을 여러 번 틀려 잠시 잠겼습니다. 잠시 뒤에 다시 시도해 주세요.";

/** 남은 시간을 분으로 올려 알린다. 1분 미만은 「잠시 뒤」. */
export function lockedLoginMessage(seconds: number | undefined): string {
  if (seconds === undefined || !(seconds > 0)) return LOCKED_FALLBACK;
  const when = seconds < 60 ? "잠시 뒤" : `${Math.ceil(seconds / 60)}분 뒤`;
  return `로그인이 잠시 막혔습니다. ${when} 다시 시도해 주세요.`;
}
