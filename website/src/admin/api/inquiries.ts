import { adminGet, adminSend } from "./client";

/** 관리자 API v0.3 3단계 P3-1 — 1:1 문의. 분류 · 상태 · 우선순위는 서버 코드값이고 화면 표기는 아래 표로 바꾼다. */
export type InquiryCategory = "account" | "gameplay" | "payment" | "tech" | "other";
export type InquiryStatus = "open" | "answered" | "closed";
export type InquiryPriority = "normal" | "urgent";

export const CATEGORY_LABEL: Record<InquiryCategory, string> = {
  account: "계정",
  gameplay: "게임플레이",
  payment: "결제",
  tech: "기술지원",
  other: "기타",
};
export const STATUS_LABEL: Record<InquiryStatus, string> = { open: "미답변", answered: "답변 완료", closed: "종료" };

export interface InquiryStats {
  total: number;
  open: number;
  today: number;
  /** 답변이 있는 문의의 (첫 답변 − 접수) 평균 시간. 없으면 null */
  avg_first_reply_hours: number | null;
}

export interface InquiryListItem {
  id: string;
  number: string;
  title: string;
  category: InquiryCategory;
  status: InquiryStatus;
  priority: InquiryPriority;
  /** 목록은 서버가 가린 이메일 */
  email: string;
  nickname: string | null;
  user_id: string | null;
  created_at: string;
  answered_at: string | null;
  reply_count: number;
}

export interface InquiryPage {
  stats: InquiryStats;
  items: InquiryListItem[];
  next_offset: number | null;
}

export interface InquiryReply {
  id: string;
  body: string;
  created_at: string;
  admin_user_id: string | null;
  admin_nickname: string | null;
}

export interface InquiryDetail {
  id: string;
  number: string;
  title: string;
  body: string;
  category: InquiryCategory;
  status: InquiryStatus;
  priority: InquiryPriority;
  /** 상세는 전체 이메일 */
  email: string;
  nickname: string | null;
  user_id: string | null;
  /** 서버가 확인한 요청 IP 의 앞 두 자리. 없으면 null */
  client_ip_display: string | null;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
  replies: InquiryReply[];
}

export type InquiryFilter = "all" | "open" | "answered" | "closed" | "urgent";

export const INQUIRY_PAGE_SIZE = 50;

/** 부를 때마다 서버가 「문의 목록 조회」 한 줄을 남긴다. */
export function fetchInquiryPage(filter: InquiryFilter, offset: number, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (filter === "urgent") params.set("priority", "urgent");
  else if (filter !== "all") params.set("status", filter);
  if (offset) params.set("offset", String(offset));
  const query = params.toString();
  return adminGet<InquiryPage>(`/api/v1/admin/inquiries${query ? `?${query}` : ""}`, signal);
}

/** 상세 — 본문 · 전체 이메일이 보이므로 서버가 「문의 열람」을 남긴다. */
export const fetchInquiry = (id: string, signal?: AbortSignal) =>
  adminGet<InquiryDetail>(`/api/v1/admin/inquiries/${encodeURIComponent(id)}`, signal);

export const replyInquiry = (id: string, body: string) =>
  adminSend<InquiryDetail>("POST", `/api/v1/admin/inquiries/${encodeURIComponent(id)}/replies`, { body });

export const updateInquiry = (id: string, patch: { status?: InquiryStatus; priority?: InquiryPriority }) =>
  adminSend<InquiryDetail>("PATCH", `/api/v1/admin/inquiries/${encodeURIComponent(id)}`, patch);
