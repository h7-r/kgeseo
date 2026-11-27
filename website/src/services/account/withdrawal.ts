import { apiUrl } from "@/config/env";
import { endLocalSession } from "@/services/session";

import { errorCode, postApi, tooManyRequestsMessage, type AccountFailure } from "./authApi";

/**
 * 회원 탈퇴(POST /api/v1/me/withdrawal, 백엔드 계약 account_withdrawal_v0.2).
 * 성공하면 서버가 로그인 · 게스트 쿠키를 지운다. 화면은 로그아웃 상태로 바꾸고 이 브라우저의 계정 값을 지운다.
 */

const WITHDRAWAL_API = apiUrl("/api/v1/me/withdrawal");

const REFUSALS: Readonly<Record<string, string>> = {
  invalid_password: "비밀번호가 맞지 않습니다.",
  admin_cannot_withdraw: "관리자 계정은 탈퇴할 수 없습니다.",
  reauth_required:
    "구글 · 네이버로만 가입한 계정은 아직 이 화면에서 탈퇴할 수 없습니다. 고객센터 1:1 문의로 요청해 주세요.",
};

export type WithdrawResult = { ok: true } | AccountFailure<"password">;

/** 이메일 비밀번호로 가입한 회원은 비밀번호가 필수다. 소셜 전용은 비워 보내면 서버가 reauth_required 로 거절한다. */
export async function withdrawAccount(password: string): Promise<WithdrawResult> {
  const result = await postApi(WITHDRAWAL_API, password ? { password } : {});
  if (result.ok) return { ok: true };
  const limited = tooManyRequestsMessage(result);
  if (limited) return { ok: false, reason: limited };
  const code = errorCode(result.body);
  if (result.status === 401 && code !== "invalid_password") {
    // 서버 세션이 끝났다(다른 창에서 탈퇴 · 로그아웃) — 화면의 로그인 표시도 거둔다
    endLocalSession();
    return { ok: false, reason: "로그인이 끝났습니다. 다시 로그인한 뒤 진행해 주세요." };
  }
  if (code && REFUSALS[code]) {
    return { ok: false, reason: REFUSALS[code], field: code === "invalid_password" ? "password" : undefined };
  }
  if (result.status === 422) return { ok: false, reason: "비밀번호를 입력해 주세요.", field: "password" };
  return { ok: false, reason: "탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}
