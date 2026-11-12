/**
 * 회원 목록 검색 · 표시 규칙(관리자 API v0.2 §3.1). 서버 규칙을 화면에서 먼저 안내할 뿐, 판정은 서버가 다시 한다.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

/** 서버가 받는 검색어 길이(앞뒤 공백을 뺀 뒤). 서버(Python len)처럼 코드 포인트로 센다 — 이모지 하나가 1 이다. */
export const SEARCH_MAX_LENGTH = 64;

export type MemberSearch =
  | { kind: "none" }
  | { kind: "tooLong" }
  /** 닉네임은 일부만 맞아도, 이메일(@ 포함)은 주소 전체가 같아야 찾는다 */
  | { kind: "nickname" | "email"; q: string };

export function readMemberSearch(raw: string | null | undefined): MemberSearch {
  const q = raw?.trim() ?? "";
  if (!q) return { kind: "none" };
  if ([...q].length > SEARCH_MAX_LENGTH) return { kind: "tooLong" };
  return { kind: q.includes("@") ? "email" : "nickname", q };
}

export interface RecentLogin {
  at: string;
  /** 실제 로그인 시각이 아니라 로그인 · 가입 때 만든 세션의 시각 — 자동 로그인으로 계속 쓰면 갱신되지 않는다 */
  isEstimate: boolean;
}

/** 실제 로그인 시각 → 없으면 세션 시작 시각(추정) → 둘 다 없으면 null(기록 없음). 서버는 두 값을 섞지 않는다. */
export function recentLogin(user: {
  last_login_at?: string | null;
  last_session_started_at?: string | null;
}): RecentLogin | null {
  if (user.last_login_at) return { at: user.last_login_at, isEstimate: false };
  if (user.last_session_started_at) return { at: user.last_session_started_at, isEstimate: true };
  return null;
}

const PROVIDER_LABELS: Record<string, string> = { local: "이메일", google: "구글", naver: "네이버" };

/** 로그인 수단. 모르는 값은 원문 그대로. */
export const providerLabel = (provider: string): string => PROVIDER_LABELS[provider] ?? provider;
