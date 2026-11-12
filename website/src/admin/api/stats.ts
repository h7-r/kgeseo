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
}

/** 관리자 계정은 기본으로 뺀다. includeInternal 이면 넣어서 센다. */
export const fetchStatsSummary = (includeInternal: boolean, signal?: AbortSignal) =>
  adminGet<StatsSummary>(`/api/v1/admin/stats/summary${includeInternal ? "?include_internal=true" : ""}`, signal);
