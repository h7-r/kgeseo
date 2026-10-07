import type { SessionUser } from "@/services/session";

/** 백엔드 인증 API(/api/v1/auth). 개발 서버는 vite proxy 로 127.0.0.1:8000 에 넘긴다. */
const AUTH_API = "/api/v1/auth";

export const SERVER_ERROR_MESSAGE = "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.";

export type AuthResponse =
  { ok: true; status: number; body: unknown } | { ok: false; status: number; body: unknown; reason: string };

/** FastAPI 오류의 detail. 문자열이거나 { code, message } 다. */
export function errorDetail(body: unknown): unknown {
  return typeof body === "object" && body !== null && "detail" in body ? body.detail : undefined;
}

export function errorCode(body: unknown): string | undefined {
  const detail = errorDetail(body);
  if (typeof detail !== "object" || detail === null || !("code" in detail)) return undefined;
  return typeof detail.code === "string" ? detail.code : undefined;
}

/** 서버가 꺼져 있어도 던지지 않고 실패 결과로 돌려준다(status 0). */
export async function postAuth(path: string, payload: unknown): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${AUTH_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, status: 0, body: null, reason: SERVER_ERROR_MESSAGE };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 프록시 오류처럼 본문이 JSON 이 아닐 수 있다.
  }

  if (!response.ok) {
    const detail = errorDetail(body);
    // 422 검증 오류의 detail 은 배열이라 화면에 그대로 띄울 수 없다. 문자열일 때만 쓴다.
    return {
      ok: false,
      status: response.status,
      body,
      reason: typeof detail === "string" && detail ? detail : SERVER_ERROR_MESSAGE,
    };
  }
  return { ok: true, status: response.status, body };
}

interface BackendUser {
  user_id?: string;
  email?: string;
  nickname?: string;
  region?: string | null;
  created_at?: string;
  provider?: string;
}

/** 가입·로그인 응답의 { user } 를 세션 모양으로 바꾼다. */
export function toSessionUserFromBackend(body: unknown): SessionUser {
  const user: BackendUser =
    typeof body === "object" && body !== null && "user" in body && typeof body.user === "object" && body.user
      ? body.user
      : {};
  const joinedAt = Date.parse(user.created_at || "");
  return {
    id: user.user_id ?? "",
    email: user.email ?? "",
    name: user.nickname ?? "",
    region: user.region ?? "",
    joinedAt: Number.isNaN(joinedAt) ? Date.now() : joinedAt,
    provider: user.provider ?? "local",
  };
}

/** 이메일·닉네임 중복 확인. 서버에 못 닿으면 「없음」으로 본다 — 가입 요청에서 서버가 다시 막는다. */
export async function existsOnServer(path: "/email-exists" | "/nickname-exists", payload: unknown) {
  const result = await postAuth(path, payload);
  return Boolean(
    result.ok &&
    typeof result.body === "object" &&
    result.body !== null &&
    "exists" in result.body &&
    result.body.exists,
  );
}
