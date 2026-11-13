import { adminGet } from "./client";

/** GET /api/v1/admin/stats/summary(관리자 API v0.2 §3.3) 중 화면이 쓰는 칸. */
export interface StatsSummary {
  generated_at: string;
  /** 기준 날짜(KST) */
  date: string;
  include_internal: boolean;
  /** 뺀 관리자 수. test_accounts 가 null 이면 테스트 계정을 아직 가려내지 못해 포함돼 있다 */
  excluded: { admins: number; test_accounts: number | null };
  members: { total: number; signups_on_date: number; signups_in_month: number };
  /** 회원은 그날 로그인하거나 플레이를 새로 시작한 사람. 게스트는 브라우저 단위로 따로 센다 */
  activity: { members_dau: number; members_mau: number; guests_dau: number; guests_mau: number };
  play_sessions: {
    created_on_date: number;
    created_on_date_by_member: number;
    created_on_date_by_guest: number;
  }; /** 미답변(open) 1:1 문의 수(관리자 API v0.3 P3-1) */
  inquiries: { open: number };
}

/** 관리자 계정은 기본으로 뺀다. includeInternal 이면 넣어서 센다. */
export const fetchStatsSummary = (includeInternal: boolean, signal?: AbortSignal) =>
  adminGet<StatsSummary>(`/api/v1/admin/stats/summary${includeInternal ? "?include_internal=true" : ""}`, signal);

// --- 2단계(계약 초안 backend/docs/contracts/admin_api_v0.2_phase2.md) ---

/** 원천이 없는 지표의 이유 코드 — 화면은 「준비 중」으로 보인다 */
export type Unavailable = Record<string, string>;

const withQuery = (path: string, params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== false) search.set(key, String(value));
  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

export interface TrafficDay {
  date: string;
  members_dau: number;
  guests_dau: number;
  signups: number;
  play_sessions_created: number;
}

export interface StatsTraffic {
  generated_at: string;
  date: string;
  days: number;
  include_internal: boolean;
  daily: TrafficDay[];
  /** 최근 5분 안에 갱신된 플레이 세션 수 — 「지금 플레이 중」의 근사값 */
  live: { active_play_sessions_5m: number; basis: string };
  unavailable: Unavailable;
}

/** 집계뿐이라 서버가 기록을 남기지 않는다. */
export const fetchStatsTraffic = (days: number, includeInternal: boolean, signal?: AbortSignal) =>
  adminGet<StatsTraffic>(withQuery("/api/v1/admin/stats/traffic", { days, include_internal: includeInternal }), signal);

export interface ActiveSession {
  nickname: string | null;
  user_id: string | null;
  case_id: string;
  started_at: string;
  last_seen_at: string;
}

export interface ActiveSessionList {
  generated_at: string;
  window_minutes: number;
  sessions: ActiveSession[];
}

/** 닉네임이 보이므로 부를 때마다 「활성 세션 조회」 한 줄이 남는다. */
export const fetchActiveSessions = (signal?: AbortSignal) =>
  adminGet<ActiveSessionList>("/api/v1/admin/stats/active-sessions", signal);

export interface CountBucket {
  label: string;
  count: number;
}

export interface RecentSignup {
  user_id: string;
  nickname: string;
  /** 전체 주소 — 화면은 maskEmail 로 가린다 */
  email: string;
  region: string | null;
  created_at: string;
  stage: string | null;
}

export interface StatsMembers {
  generated_at: string;
  date: string;
  include_internal: boolean;
  months: number;
  totals: {
    total: number;
    total_at_prev_month_end: number;
    signups_this_month: number;
    signups_prev_month: number;
    mau: number;
    mau_prev_30_days: number;
  };
  monthly_signups: { month: string; signups: number }[];
  by_region: CountBucket[];
  by_provider: CountBucket[];
  signups_on_date: RecentSignup[];
  recent_signups: RecentSignup[];
  unavailable: Unavailable;
}

/** 가입자 목록이 들어 부를 때마다 「회원 통계 조회」 한 줄이 남는다. */
export const fetchStatsMembers = (months: number, includeInternal: boolean, signal?: AbortSignal) =>
  adminGet<StatsMembers>(
    withQuery("/api/v1/admin/stats/members", { months, include_internal: includeInternal }),
    signal,
  );

export type PuzzleJudge = "server" | "screen" | "step";

export interface PuzzleStats {
  objective_id: string;
  judge: PuzzleJudge;
  attempts: number;
  wrong: number;
  hint_requests: number;
  completed_people: number;
}

export interface StatsGame {
  generated_at: string;
  date: string;
  days: number;
  people: number;
  funnel: { phase: string; people: number }[];
  stages: { stage: number; entered: number; completed: number }[];
  puzzles: PuzzleStats[];
  avg_completion_minutes: number | null;
  completed_runs: number;
  unavailable: Unavailable;
}

/** 집계뿐이라 서버가 기록을 남기지 않는다. 정답 값은 응답에 없다. */
export const fetchStatsGame = (days: number, signal?: AbortSignal) =>
  adminGet<StatsGame>(withQuery("/api/v1/admin/stats/game", { days }), signal);

export interface SecuritySummary {
  generated_at: string;
  login_throttle: { locked_now: number; keys_with_failures: number; failures_in_window: number };
  admin_logins_7d: { user_id: string; nickname: string | null; at: string }[];
  audit_actions_24h: CountBucket[];
  unavailable: Unavailable;
}

/** 관리자 로그인 이름이 들어 부를 때마다 「보안 집계 조회」 한 줄이 남는다. */
export const fetchSecuritySummary = (signal?: AbortSignal) =>
  adminGet<SecuritySummary>("/api/v1/admin/security/summary", signal);
