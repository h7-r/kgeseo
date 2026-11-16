import { adminGet, adminSend } from "./client";

/**
 * 공지사항 API v0.2(세진 11/16, 계약 backend/docs/contracts/notices_api_v0.2.md) — 관리자 쪽.
 * 분류 · 상태는 서버 코드값이고 화면 표기는 아래 표로 바꾼다. 상태는 서버가 published_at 으로 계산한다
 * (null = 초안 · 미래 = 예약 · 현재/과거 = 게시). 등록 · 수정 · 삭제는 활동 로그(create/update/delete_notice)에 남는다.
 */
export type NoticeCategory = "maintenance" | "event" | "update" | "info";
export type NoticeStatus = "draft" | "scheduled" | "published";

export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  maintenance: "점검",
  event: "이벤트",
  update: "업데이트",
  info: "안내",
};
export const NOTICE_STATUS_LABEL: Record<NoticeStatus, string> = {
  draft: "초안",
  scheduled: "예약",
  published: "게시",
};

export interface AdminNoticeItem {
  id: string;
  title: string;
  category: NoticeCategory;
  is_pinned: boolean;
  status: NoticeStatus;
  /** 서버 시각(UTC, 시간대 표기 없음). 초안은 null */
  published_at: string | null;
  /** 작성한 관리자 — 계정이 사라졌으면 null */
  created_by: { user_id: string; nickname: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface AdminNoticeDetail extends AdminNoticeItem {
  /** 글자만(HTML 로 해석하지 않는다 — 공지 · 문의 화면 규칙) */
  body: string;
}

export interface AdminNoticePage {
  items: AdminNoticeItem[];
  next_offset: number | null;
}

/** 등록 · 수정 요청 본문. 수정은 바꾸는 칸만 보내도 된다(PATCH) */
export interface NoticeInput {
  /** 1~200자 */
  title: string;
  /** 1~20,000자 */
  body: string;
  category: NoticeCategory;
  is_pinned: boolean;
  /** 시간대 필수(UTC Z 로 보낸다). null 이면 초안 */
  published_at: string | null;
}

export const NOTICE_PAGE_SIZE = 50;

/** 최근 작성 먼저. status 를 주면 그 상태만(서버가 거른다). 조회는 기록하지 않는다 */
export function fetchAdminNoticePage(status: NoticeStatus | undefined, offset: number, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (offset) params.set("offset", String(offset));
  const query = params.toString();
  return adminGet<AdminNoticePage>(`/api/v1/admin/notices${query ? `?${query}` : ""}`, signal);
}

export const fetchAdminNotice = (id: string, signal?: AbortSignal) =>
  adminGet<AdminNoticeDetail>(`/api/v1/admin/notices/${encodeURIComponent(id)}`, signal);

/** 기록 `create_notice` */
export const createNotice = (input: NoticeInput) =>
  adminSend<AdminNoticeDetail>("POST", "/api/v1/admin/notices", input);

/** 기록 `update_notice` */
export const updateNotice = (id: string, patch: Partial<NoticeInput>) =>
  adminSend<AdminNoticeDetail>("PATCH", `/api/v1/admin/notices/${encodeURIComponent(id)}`, patch);

/** 기록 `delete_notice` */
export const deleteNotice = (id: string) =>
  adminSend<void>("DELETE", `/api/v1/admin/notices/${encodeURIComponent(id)}`);
