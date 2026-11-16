/**
 * 공지사항 공개 API(v0.2, 세진 11/16). 로그인 없이 읽는다. 목록은 분류별로 6개씩 쪽을 넘기고(서버 기본값),
 * 고정 공지는 전체 목록 맨 앞에 한 번만 온다. 본문은 상세에서만 온다 — 글자만 보여 주고 HTML 로 해석하지 않는다.
 */
import { apiUrl } from "@/config/env";

export type NoticeCategoryCode = "maintenance" | "event" | "update" | "info";
/** 화면의 한글 분류(data/support.ts NOTICE_FILTERS 와 같다) */
export type NoticeCategoryLabel = "점검" | "이벤트" | "업데이트" | "안내";

const CODE_TO_LABEL: Record<NoticeCategoryCode, NoticeCategoryLabel> = {
  maintenance: "점검",
  event: "이벤트",
  update: "업데이트",
  info: "안내",
};
const LABEL_TO_CODE: Record<NoticeCategoryLabel, NoticeCategoryCode> = {
  점검: "maintenance",
  이벤트: "event",
  업데이트: "update",
  안내: "info",
};

export const noticeCategoryLabel = (code: string): NoticeCategoryLabel | string =>
  CODE_TO_LABEL[code as NoticeCategoryCode] ?? code;
export const noticeCategoryCode = (label: NoticeCategoryLabel): NoticeCategoryCode => LABEL_TO_CODE[label];

export interface PublicNotice {
  id: string;
  title: string;
  category: NoticeCategoryCode;
  is_pinned: boolean;
  /** UTC, 시간대 표기 없음(2026-11-16T03:00:00) */
  published_at: string;
}

export interface PublicNoticeDetail extends PublicNotice {
  body: string;
}

export interface PublicNoticePage {
  items: PublicNotice[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return (await response.json()) as T;
}

/** 분류를 비우면 전체. 쪽은 1부터 */
export function fetchNotices(options: { category?: NoticeCategoryCode; page: number }, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(options.page) });
  if (options.category) params.set("category", options.category);
  return readJson<PublicNoticePage>(`/api/v1/notices?${params}`, signal);
}

export const fetchNoticeDetail = (id: string, signal?: AbortSignal) =>
  readJson<PublicNoticeDetail>(`/api/v1/notices/${encodeURIComponent(id)}`, signal);

// 끝에 Z 나 ±hh:mm 이 있으면 시간대가 적힌 값. 서버는 UTC 를 시간대 표기 없이 보낸다(기존 API 와 같다)
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** 2026.11.16 — 한국 날짜. 못 읽는 값은 원문 */
export function formatNoticeDate(publishedAt: string): string {
  const trimmed = publishedAt.trim();
  const time = Date.parse(TIMEZONE_SUFFIX.test(trimmed) ? trimmed : `${trimmed}Z`);
  if (Number.isNaN(time)) return publishedAt;
  const kst = new Date(time + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${kst.getUTCFullYear()}.${pad(kst.getUTCMonth() + 1)}.${pad(kst.getUTCDate())}`;
}
