import type { SessionUser } from "@/services/session";

import { normalizeEmail, type ConsentKind } from "./db";

/** 백엔드 인증 API(/api/v1/auth). 개발 서버는 vite proxy 로 127.0.0.1:8000 에 넘긴다. */
const AUTH_API = "/api/v1/auth";

const SERVER_ERROR_MESSAGE = "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.";

type AuthResponse =
  { ok: true; status: number; body: unknown } | { ok: false; status: number; body: unknown; reason: string };

// 약관 글이 바뀌면 올린다. 동의 기록에 함께 남아 어느 판에 동의했는지 알 수 있다(consent_log.version).
const TERMS_VERSION = "2026-09";

export type AccountFailure<Field extends string = never> = {
  ok: false;
  reason: string;
  /** 화면이 문구 대신 비교할 실패 종류 */
  code?: "unknownEmail";
  /** 문제가 난 입력칸 */
  field?: Field;
};

type SignUpResult = { ok: true; user: SessionUser } | AccountFailure<"email" | "nickname">;
type AuthenticateResult = { ok: true; user: SessionUser } | AccountFailure;

interface SignUpInput {
  email: string;
  password: string;
  nickname?: string;
  region?: string;
  consents?: Partial<Record<ConsentKind, boolean>>;
}

/** FastAPI 오류의 detail. 문자열이거나 { code, message } 다. */
function errorDetail(body: unknown): unknown {
  return typeof body === "object" && body !== null && "detail" in body ? body.detail : undefined;
}

function errorCode(body: unknown): string | undefined {
  const detail = errorDetail(body);
  if (typeof detail !== "object" || detail === null || !("code" in detail)) return undefined;
  return typeof detail.code === "string" ? detail.code : undefined;
}

/** 서버가 꺼져 있어도 던지지 않고 실패 결과로 돌려준다(status 0). */
async function postAuth(path: string, payload: unknown): Promise<AuthResponse> {
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
function toSessionUserFromBackend(body: unknown): SessionUser {
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
async function existsOnServer(path: "/email-exists" | "/nickname-exists", payload: unknown) {
  const result = await postAuth(path, payload);
  return Boolean(
    result.ok &&
    typeof result.body === "object" &&
    result.body !== null &&
    "exists" in result.body &&
    result.body.exists,
  );
}

export function isEmailTaken(email: string | undefined): Promise<boolean> {
  return existsOnServer("/email-exists", { email: normalizeEmail(email) });
}

/** 이 닉네임을 누가 쓰고 있나(대소문자 무시: Test = TEST) */
export function isNicknameTaken(nickname: string | undefined): Promise<boolean> {
  return existsOnServer("/nickname-exists", {
    nickname: String(nickname || "")
      .normalize("NFKC")
      .trim(),
  });
}

/** 이메일·비밀번호 확인은 서버가 한다. 성공하면 signIn 에 바로 넘길 사용자를 돌려준다. */
export async function authenticate(email: string, password: string): Promise<AuthenticateResult> {
  const result = await postAuth("/login", { email, password });
  if (!result.ok) {
    // 없는 계정과 틀린 비밀번호를 같은 말로 답해 어떤 메일이 가입됐는지 캐낼 수 없게 한다.
    if (result.status === 401) return { ok: false, reason: "이메일 또는 비밀번호가 올바르지 않습니다." };
    return { ok: false, reason: result.reason };
  }
  return { ok: true, user: toSessionUserFromBackend(result.body) };
}

export async function signUp({ email, password, nickname, region, consents = {} }: SignUpInput): Promise<SignUpResult> {
  const result = await postAuth("/register", {
    email,
    password,
    nickname,
    region,
    consent: {
      terms: Boolean(consents.terms),
      privacy: Boolean(consents.privacyCollection),
      age: Boolean(consents.over14),
      terms_version: TERMS_VERSION,
    },
  });

  if (!result.ok) {
    const detail = errorDetail(result.body);
    if (errorCode(result.body) === "invalid_nickname") {
      return { ok: false, field: "nickname", reason: "사용할 수 없는 닉네임입니다." };
    }
    if (result.status === 409 && detail === "Email already registered.") {
      return { ok: false, field: "email", reason: "이미 가입된 이메일입니다. 로그인해 주세요." };
    }
    if (result.status === 409 && detail === "Nickname already registered.") {
      return { ok: false, field: "nickname", reason: "이미 사용 중인 닉네임입니다." };
    }
    if (result.status === 422) return { ok: false, reason: "입력값을 다시 확인해 주세요." };
    return { ok: false, reason: result.reason || "가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." };
  }

  return { ok: true, user: toSessionUserFromBackend(result.body) };
}
