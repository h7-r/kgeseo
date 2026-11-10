import { apiUrl } from "@/config/env";
import { errorCode, toSessionUserFromBackend } from "@/services/account/authApi";
import { signIn, signOut } from "@/services/session";

import { adminGet } from "./client";

/** GET /api/v1/me. 관리자인지는 이 응답의 role 로만 정한다. */
export interface AdminMe {
  user_id: string;
  email: string;
  nickname: string;
  region: string | null;
  role: string;
}

export const ADMIN_ROLE = "admin";

export const fetchMe = (signal?: AbortSignal) => adminGet<AdminMe>("/api/v1/me", signal);

export type LoginFailure = "invalid" | "locked" | "input" | "offline" | "server";

export type LoginResult =
  { ok: true } | { ok: false; failure: LoginFailure; status: number; retryAfterSeconds?: number };

const UNREACHABLE: readonly number[] = [502, 503, 504];

/**
 * 관리자 로그인. 웹 로그인(authenticate)과 달리 서버에 못 닿을 때 시험 계정으로 넘어가는 길이 없다.
 * 성공하면 웹 세션도 맞춰 두지만, 들어갈 수 있는지는 뒤이어 /me 로 다시 묻는다.
 */
export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/v1/auth/login"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, failure: "offline", status: 0 };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 프록시 오류처럼 본문이 JSON 이 아닐 수 있다.
  }

  if (response.ok) {
    const user = toSessionUserFromBackend(body);
    if (user) signIn(user);
    return { ok: true };
  }
  const { status } = response;
  if (status === 401) return { ok: false, failure: "invalid", status };
  if (status === 429 && errorCode(body) === "login_locked") {
    const retryAfter = Number(response.headers.get("Retry-After"));
    return {
      ok: false,
      failure: "locked",
      status,
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  }
  if (status === 422) return { ok: false, failure: "input", status };
  if (UNREACHABLE.includes(status)) return { ok: false, failure: "offline", status };
  return { ok: false, failure: "server", status };
}

/** 서버 세션과 웹 세션을 함께 끝낸다. */
export const logout = () => signOut();
