/**
 * 요청 제한(429)의 남은 시간 안내. 서버는 다시 보내도 되는 때까지 남은 초를 Retry-After 에 정수로 준다.
 * 로그인 잠김(login_locked)과 요청 과다(rate_limited)가 같은 머리를 쓴다.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

/** Retry-After 를 초로. 양의 정수만 받는다 — 비었거나 날짜 · 소수 · 음수 · 글자면 undefined. */
export function parseRetryAfter(raw: string | null | undefined): number | undefined {
  const value = raw?.trim() ?? "";
  if (!/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > 0 && Number.isSafeInteger(seconds) ? seconds : undefined;
}

/** 「30초 뒤」 · 「15분 뒤」. 1분이 넘으면 분으로 올린다. 모르면 「잠시 뒤」. */
export function waitPhrase(seconds: number | undefined): string {
  if (seconds === undefined || !(seconds > 0)) return "잠시 뒤";
  return seconds < 60 ? `${seconds}초 뒤` : `${Math.ceil(seconds / 60)}분 뒤`;
}

/** 로그인을 여러 번 틀려 잠겼을 때(login_locked). */
export const lockedLoginMessage = (seconds: number | undefined) =>
  `로그인을 여러 번 틀려 잠시 잠겼습니다. ${waitPhrase(seconds)} 다시 시도해 주세요.`;

/** 같은 곳에서 요청이 몰려 잠시 막혔을 때(rate_limited) — 가입 · 중복 확인. */
export const rateLimitedMessage = (seconds: number | undefined) =>
  `요청이 많아 잠시 막혔습니다. ${waitPhrase(seconds)} 다시 시도해 주세요.`;
