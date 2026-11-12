/**
 * 관리자 감사 기록(활동 로그)의 이름표와 조회 기간(관리자 API v0.2 §3.4).
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

/** 서버가 남기는 기록 종류. 고를 수 있는 것만 둔다 — 통계 조회(view_stats_summary)는 아직 남기지 않는다(D5-b). */
export const AUDIT_ACTION_FILTERS = [
  { id: "all", label: "전체" },
  { id: "read_user", label: "회원 상세 열람" },
  { id: "list_users", label: "회원 목록 조회" },
  { id: "list_audit_logs", label: "활동 로그 조회" },
  { id: "export_beta_events", label: "베타 기록 받기" },
  { id: "view_member_stats", label: "회원 통계 조회" },
  { id: "view_active_sessions", label: "활성 세션 조회" },
  { id: "view_security_summary", label: "보안 집계 조회" },
] as const;

export type AuditActionFilter = (typeof AUDIT_ACTION_FILTERS)[number]["id"];

const ACTION_LABELS: Record<string, string> = {
  ...Object.fromEntries(AUDIT_ACTION_FILTERS.filter((item) => item.id !== "all").map((item) => [item.id, item.label])),
  view_stats_summary: "통계 조회",
};

/** 모르는 값(나중 버전에 생긴 종류)은 원문 그대로 보인다. */
export const auditActionLabel = (action: string): string => ACTION_LABELS[action] ?? action;

/** 서버가 받는 최대 기간(양 끝 포함) */
export const AUDIT_MAX_DAYS = 92;

/** 서버 기본은 최근 30일, 최대 92일(양 끝 포함). */
export const AUDIT_PERIODS = [
  { id: "1", label: "오늘", days: 1 },
  { id: "7", label: "7일", days: 7 },
  { id: "30", label: "30일", days: 30 },
  { id: "92", label: "92일", days: 92 },
] as const;

export type AuditPeriodId = (typeof AUDIT_PERIODS)[number]["id"];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 한국 날짜(YYYY-MM-DD). 서버의 날짜 질의는 모두 KST 다 — 브라우저 시간대와 상관없이 +9시간으로 셈한다. */
export const kstDate = (time: number): string => new Date(time + KST_OFFSET_MS).toISOString().slice(0, 10);

/** 오늘(KST)을 끝으로 하는 days 일 기간. */
export function kstPeriod(days: number, now: number): { from: string; to: string } {
  return { from: kstDate(now - (days - 1) * DAY_MS), to: kstDate(now) };
}
