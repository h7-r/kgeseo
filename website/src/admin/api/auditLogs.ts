import { adminGet } from "./client";

/** 사용자가 사라졌으면 nickname 이 null 이다(감사 기록에는 외래 키가 없다). */
export interface AuditActor {
  user_id: string;
  nickname: string | null;
}

/** GET /api/v1/admin/audit-logs(관리자 API v0.2 §3.4) 한 줄. 이메일 · IP · 브라우저 정보는 없다. */
export interface AuditLogEntry {
  id: number;
  created_at: string;
  action: string;
  admin: AuditActor;
  target: AuditActor | null;
}

export interface AuditLogPage {
  logs: AuditLogEntry[];
  next_offset: number | null;
}

export interface AuditLogQuery {
  /** KST YYYY-MM-DD, 양 끝 포함 */
  from: string;
  to: string;
  action?: string;
  offset?: number;
}

/** 서버가 한 번에 주는 기록 수. */
export const AUDIT_PAGE_SIZE = 50;

/** 부를 때마다 서버가 「활동 로그 조회」 한 줄을 남긴다 — 방금 한 조회는 다음 조회부터 보인다. */
export function fetchAuditLogs(query: AuditLogQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.action) params.set("action", query.action);
  if (query.offset) params.set("offset", String(query.offset));
  return adminGet<AuditLogPage>(`/api/v1/admin/audit-logs?${params}`, signal);
}
