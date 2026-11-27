import { apiUrl } from "@/config/env";
import { endLocalSession } from "@/services/session";

import { errorCode, postApi, tooManyRequestsMessage, type AccountFailure, type AuthResponse } from "./authApi";

/**
 * 비밀번호 찾기 · 변경 API(백엔드 계약 password_reset_v0.1). 서버가 가입 여부를 드러내지 않으므로 화면도
 * 「없는 이메일」을 따로 말하지 않는다. 서버 오류의 한국어 문장(detail.message)을 그대로 보여 준다.
 */

const RESET_API = apiUrl("/api/v1/auth/password-reset");
const CHANGE_API = apiUrl("/api/v1/me/password");

const FALLBACK = "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** 서버가 준 한국어 안내. 429 는 남은 시간을 넣은 문장으로, 그 밖은 detail.message, 없으면 기본 문장. */
function failureReason(result: AuthResponse): string {
  if (result.ok) return "";
  const message = serverMessage(result);
  // 코드 확인 하루 잠금은 서버 문장이 다음에 할 일(내일 다시 · 고객센터)을 말한다 — 「n분 뒤」 문장으로 바꾸지 않는다(미르 11/27)
  if (errorCode(result.body) === "reset_verify_locked" && message) return message;
  const limited = tooManyRequestsMessage(result);
  if (limited) return limited;
  return message || FALLBACK;
}

function serverMessage(result: AuthResponse): string {
  const body = result.body;
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = body.detail;
    if (typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string") {
      return detail.message;
    }
  }
  return "";
}

/** ① 코드 메일 요청. 가입 안 된 이메일이어도 성공으로 온다. */
export async function requestResetCode(email: string): Promise<{ ok: true } | AccountFailure<"email">> {
  const result = await postApi(`${RESET_API}/request`, { email });
  if (result.ok) return { ok: true };
  return {
    ok: false,
    reason: failureReason(result),
    field: errorCode(result.body) === "invalid_email" ? "email" : undefined,
  };
}

/** ② 코드 확인. 맞으면 새 비밀번호를 저장할 증표(10분)를 받는다. */
export async function confirmResetCode(
  email: string,
  code: string,
): Promise<{ ok: true; resetToken: string } | AccountFailure<"code">> {
  const result = await postApi(`${RESET_API}/verify`, { email, code });
  if (result.ok) {
    const body = result.body;
    const token =
      typeof body === "object" && body !== null && "reset_token" in body && typeof body.reset_token === "string"
        ? body.reset_token
        : "";
    return token ? { ok: true, resetToken: token } : { ok: false, reason: FALLBACK };
  }
  const field = errorCode(result.body) === "invalid_reset_code" ? "code" : undefined;
  return { ok: false, reason: failureReason(result), field };
}

type CompleteResult = { ok: true } | (AccountFailure<"newPassword"> & { expired?: boolean });

/** ③ 새 비밀번호 저장. 성공하면 모든 기기에서 로그아웃된다 — 화면은 로그인으로 보낸다. */
export async function completeReset(resetToken: string, newPassword: string): Promise<CompleteResult> {
  const result = await postApi(`${RESET_API}/complete`, { reset_token: resetToken, new_password: newPassword });
  if (result.ok) return { ok: true };
  const code = errorCode(result.body);
  return {
    ok: false,
    reason: failureReason(result),
    field: code === "invalid_password" ? "newPassword" : undefined,
    expired: code === "invalid_reset_token",
  };
}

/** 로그인한 채 비밀번호 바꾸기. 이 브라우저(같은 쿠키를 쓰는 다른 탭 포함)는 로그인이 유지되고 다른 기기는 로그아웃된다. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | AccountFailure<"current" | "next">> {
  const result = await postApi(CHANGE_API, { current_password: currentPassword, new_password: newPassword });
  if (result.ok) return { ok: true };
  const code = errorCode(result.body);
  if (result.status === 401 && code !== "invalid_password") {
    // 서버 세션이 끝났다 — 화면의 로그인 표시도 거둔다(/me/* 가 401 이면 endLocalSession, session.ts 규칙)
    endLocalSession();
    return { ok: false, reason: "로그인이 끝났습니다. 다시 로그인한 뒤 바꿔 주세요." };
  }
  // 401 invalid_password = 지금 비밀번호가 틀림, 422 invalid_password · same_password = 새 비밀번호 문제
  const field =
    code === "invalid_password"
      ? result.status === 401
        ? "current"
        : "next"
      : code === "same_password"
        ? "next"
        : undefined;
  return { ok: false, reason: failureReason(result), field };
}
