import type { SessionUser } from "@/services/session";

import { normalizeEmail, type ConsentKind } from "./db";

/** 백엔드 인증 API(/api/v1/auth). 개발 서버는 vite proxy 로 127.0.0.1:8000 에 넘긴다. */
const AUTH_API = "/api/v1/auth";

const SERVER_ERROR_MESSAGE = "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const INPUT_ERROR_MESSAGE = "입력값을 다시 확인해 주세요.";

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

export function errorCode(body: unknown): string | undefined {
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
    // detail 은 문자열이거나 { code, message } 다. 영문 서버 문구가 그대로 뜨지 않게 호출한 쪽이 status·code 로 고른다.
    return {
      ok: false,
      status: response.status,
      body,
      reason: typeof detail === "string" && detail ? detail : SERVER_ERROR_MESSAGE,
    };
  }
  return { ok: true, status: response.status, body };
}

const BACKEND_PROVIDERS = ["local", "google", "naver"] as const;
type BackendProvider = (typeof BACKEND_PROVIDERS)[number];

/** 로컬·구글·네이버 로그인과 소셜 가입 완료가 함께 돌려주는 { user } 의 모양. */
export interface BackendUser {
  user_id: string;
  email: string;
  nickname: string;
  region: string | null;
  created_at: string;
  provider: BackendProvider;
}

function isBackendUser(value: unknown): value is BackendUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.user_id === "string" &&
    user.user_id !== "" &&
    typeof user.email === "string" &&
    typeof user.nickname === "string" &&
    (user.region === null || typeof user.region === "string") &&
    typeof user.created_at === "string" &&
    BACKEND_PROVIDERS.some((provider) => provider === user.provider)
  );
}

// 끝에 Z 나 ±hh:mm 이 있으면 시간대가 적힌 값이다.
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * 서버 시각을 밀리초로. 서버는 UTC 를 시간대 표기 없이 보내는데, Date.parse 는 표기가 없으면 현지 시각으로 읽는다.
 * 표기가 없을 때만 Z 를 붙인다 — 서버가 나중에 Z 를 붙여 보내도 그대로 맞다.
 */
export function parseBackendTimestamp(value: string): number | undefined {
  // 마이크로초(6자리)는 브라우저마다 읽는 법이 달라 밀리초까지만 쓴다.
  const trimmed = value.trim().replace(/(\.\d{3})\d+/, "$1");
  const time = Date.parse(TIMEZONE_SUFFIX.test(trimmed) ? trimmed : `${trimmed}Z`);
  return Number.isNaN(time) ? undefined : time;
}

/** 로그인·가입 응답의 { user } 를 세션 모양으로 바꾼다. 모양이 어긋나면 null — 빈 사용자로 로그인시키지 않는다. */
export function toSessionUserFromBackend(body: unknown): SessionUser | null {
  const user = typeof body === "object" && body !== null && "user" in body ? body.user : undefined;
  if (!isBackendUser(user)) return null;
  return {
    id: user.user_id,
    email: user.email,
    name: user.nickname,
    region: user.region ?? "",
    joinedAt: parseBackendTimestamp(user.created_at) ?? Date.now(),
    provider: user.provider,
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
    // 422 { code, message } 는 입력 형식 문제다. 통신 오류로 안내하지 않고, 서버 문구도 그대로 띄우지 않는다.
    if (result.status === 422 && errorCode(result.body)) return { ok: false, reason: INPUT_ERROR_MESSAGE };
    return { ok: false, reason: result.reason };
  }
  const user = toSessionUserFromBackend(result.body);
  return user ? { ok: true, user } : { ok: false, reason: SERVER_ERROR_MESSAGE };
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
    if (result.status === 422) return { ok: false, reason: INPUT_ERROR_MESSAGE };
    return { ok: false, reason: result.reason || "가입 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." };
  }

  const user = toSessionUserFromBackend(result.body);
  return user ? { ok: true, user } : { ok: false, reason: SERVER_ERROR_MESSAGE };
}
