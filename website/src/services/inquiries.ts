/**
 * 1:1 문의 서버(관리자 API v0.3 3단계 P3-1, 11/13). 접수는 로그인 없이도 되고, 로그인한 채 접수하면 마이페이지 「내 문의」에 답변이 보인다.
 * 비회원 접수는 서버에 메일 발송이 없어 운영팀이 입력한 이메일로 따로 답한다 — 화면이 접수 전에 그렇게 안내한다.
 */
import { apiUrl } from "@/config/env";
import { parseRetryAfter, rateLimitedMessage } from "@/lib/retryAfter";
import { endLocalSession } from "@/services/session";

export type InquiryCategory = "account" | "gameplay" | "payment" | "tech" | "other";

/** 웹 폼의 한글 유형 → 서버 코드. 모르는 값은 기타. */
const CATEGORY_CODE: Record<string, InquiryCategory> = {
  계정: "account",
  게임플레이: "gameplay",
  결제: "payment",
  기술지원: "tech",
  기타: "other",
};
export const toCategoryCode = (label: string): InquiryCategory => CATEGORY_CODE[label] ?? "other";

const CATEGORY_LABEL: Record<InquiryCategory, string> = {
  account: "계정",
  gameplay: "게임플레이",
  payment: "결제",
  tech: "기술지원",
  other: "기타",
};
export const categoryLabel = (code: string): string => CATEGORY_LABEL[code as InquiryCategory] ?? code;

export type SubmitResult =
  | {
      ok: true;
      id: string;
      number: string;
      createdAt: number;
      /** 서버가 실제로 회원 계정에 연결해 저장했나(`is_member`). 옛 서버라 값이 없으면 null */
      isMember: boolean | null;
    }
  | { ok: false; reason: string; retryAfter?: number };

/**
 * 접수 완료 안내를 누구 기준으로 보일까(11/23) — 화면의 로그인 표시가 아니라 서버가 실제로 저장한 결과로 고른다.
 * 화면은 로그인으로 보이는데 서버 세션이 만료 · 폐기됐으면 문의는 비회원으로 저장된다. 그때 「마이페이지에서 볼 수 있습니다」를
 * 보이면 「내 문의」에 없는 문의를 찾게 된다(해랑 11/20 점검 · 세진 인수인계).
 *   isMember          회원 안내(마이페이지 「내 문의」)를 보일까 — 서버 값, 없으면(옛 서버) 화면의 로그인 표시
 *   isSessionExpired  화면은 로그인인데 서버는 비회원으로 저장했다 — 화면의 로그인 표시를 거두고 만료를 알린다.
 *                     시연용 테스트 계정은 서버에 없는 계정이라 늘 비회원으로 저장된다 — 만료가 아니다
 */
export function receiptAudience(
  isMember: boolean | null,
  isSignedInOnScreen: boolean,
  isTestAccount: boolean,
): { isMember: boolean; isSessionExpired: boolean } {
  if (isMember === null) return { isMember: isSignedInOnScreen, isSessionExpired: false };
  return { isMember, isSessionExpired: !isMember && isSignedInOnScreen && !isTestAccount };
}

const SERVER_ERROR_MESSAGE = "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.";

export async function submitInquiry(input: {
  category: InquiryCategory;
  title: string;
  body: string;
  email: string;
}): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/v1/inquiries"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, reason: SERVER_ERROR_MESSAGE };
  }
  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    return { ok: false, reason: rateLimitedMessage(retryAfter), retryAfter };
  }
  if (response.status === 422)
    return { ok: false, reason: "입력값을 다시 확인해 주세요. 이메일 형식과 글자 수를 봐 주세요." };
  if (!response.ok) return { ok: false, reason: SERVER_ERROR_MESSAGE };
  try {
    const body = (await response.json()) as { id: string; number: string; created_at: string; is_member?: unknown };
    return {
      ok: true,
      id: body.id,
      number: body.number,
      createdAt: parseUtc(body.created_at),
      isMember: typeof body.is_member === "boolean" ? body.is_member : null,
    };
  } catch {
    return { ok: false, reason: SERVER_ERROR_MESSAGE };
  }
}

export interface MyInquiryReply {
  body: string;
  created_at: string;
}

export interface MyInquiry {
  id: string;
  number: string;
  category: InquiryCategory;
  title: string;
  body: string;
  status: "open" | "answered" | "closed";
  created_at: string;
  answered_at: string | null;
  replies: MyInquiryReply[];
}

const STATUS_LABEL: Record<MyInquiry["status"], string> = { open: "답변 대기", answered: "답변 완료", closed: "종료" };
export const inquiryStatusLabel = (status: MyInquiry["status"]): string => STATUS_LABEL[status];

/** 로그인한 계정으로 접수한 문의 전부. 서버가 안 되면 null(화면은 「불러오지 못함」). */
export async function fetchMyInquiries(signal?: AbortSignal): Promise<MyInquiry[] | null> {
  try {
    const response = await fetch(apiUrl("/api/v1/me/inquiries"), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    // 서버 세션이 끝났다 — 이 탭의 로그인 표시도 거둔다.
    if (response.status === 401) endLocalSession();
    if (!response.ok) return null;
    const body = (await response.json()) as { items: MyInquiry[] };
    return body.items;
  } catch {
    return null;
  }
}

/** 2026.11.10 16:20 — 보는 사람의 시간대로 */
export function formatInquiryDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 서버 시각은 UTC naive ISO(`2026-11-13T05:10:00`). Z 가 없으면 UTC 로 본다. */
export function parseUtc(value: string): number {
  const text = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? Date.now() : ms;
}
