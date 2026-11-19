import { adminGet } from "./client";

/** 관리자 API v0.3 3단계 P3-3 — 콘텐츠 읽기 전용. 정답 · 서버 런타임 · 원문은 어떤 응답에도 없다. */
export interface ContentCounts {
  zones: number;
  objects: number;
  interactions: number;
}

export interface ContentVersion {
  content_version: number;
  /** DB 등록값 그대로 */
  content_fingerprint: string;
  publication_status: string | null;
  registered_at: string;
  state_updated_at: string | null;
  /** 그 버전의 client 콘텐츠를 읽을 수 있을 때만. 못 읽으면 null */
  counts: ContentCounts | null;
}

export interface ContentCase {
  case_id: string;
  source: "published" | "legacy";
  legacy: boolean;
  versions: ContentVersion[];
  counts: ContentCounts | null;
}

export interface ContentZone {
  zone_id: string;
  zone_name: string;
  zone_type: string;
  objects: number;
  interactions: number;
}

export interface ContentEvent {
  content_version: number;
  from_status: string | null;
  to_status: string;
  reason: string;
  actor: string;
  at: string;
}

export interface ContentCaseDetail extends ContentCase {
  zones: ContentZone[];
  interactions_by_type: Record<string, number>;
  events: ContentEvent[];
}

export const fetchContents = (signal?: AbortSignal) =>
  adminGet<{ cases: ContentCase[] }>("/api/v1/admin/contents", signal);

export const fetchContent = (caseId: string, signal?: AbortSignal) =>
  adminGet<ContentCaseDetail>(`/api/v1/admin/contents/${encodeURIComponent(caseId)}`, signal);
