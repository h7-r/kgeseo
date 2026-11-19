import type { SessionUser } from "@/services/session";

import { normalizeEmail, type ConsentKind } from "./db";
import { apiUrl } from "@/config/env";
import { lockedLoginMessage, parseRetryAfter, rateLimitedMessage } from "@/lib/retryAfter";
import { TEST_ACCOUNT } from "./testAccount";

/** 백엔드 인증 API(/api/v1/auth). 개발 서버는 vite proxy 로 127.0.0.1:8000 에 넘긴다. */
const AUTH_API = apiUrl("/api/v1/auth");

const SERVER_ERROR_MESSAGE = "서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const INPUT_ERROR_MESSAGE = "입력값을 다시 확인해 주세요.";

type AuthResponse =
  | { ok: true; status: number; body: unknown }
  | {
      ok: false;
      status: number;
      body: unknown;
      reason: string;
      /** 429 일 때 다시 보내도 되기까지 남은 초(Retry-After) */
      retryAfter?: number;
    };

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

/** 서버가 짚어 줄 수 있는 가입 칸 */
type SignUpField = "email" | "nickname" | "password";
type SignUpResult = { ok: true; user: SessionUser } | AccountFailure<SignUpField>;
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
      credentials: "include",
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
      retryAfter: parseRetryAfter(response.headers.get("Retry-After")),
    };
  }
  return { ok: true, status: response.status, body };
}

/** 429 의 안내. 로그인 잠김(login_locked)과 요청 과다(rate_limited)를 code 로 가른다. 429 가 아니면 undefined. */
function tooManyRequestsMessage(result: AuthResponse): string | undefined {
  if (result.ok || result.status !== 429) return undefined;
  return errorCode(result.body) === "login_locked"
    ? lockedLoginMessage(result.retryAfter)
    : rateLimitedMessage(result.retryAfter);
}

/** 중복 확인이 요청 제한에 걸렸다 — 「없음」으로 넘기지 않고 칸에 안내를 띄운다. */
export class DuplicateCheckLimitedError extends Error {}

/** 중복 확인이 서버 답을 못 받았다(통신 실패·5xx). 화면은 입력을 이어 가고, 제출 때 다시 묻는다. */
export class DuplicateCheckUnavailableError extends Error {}

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

/**
 * 이메일·닉네임 중복 확인. 서버가 답한 것만 돌려준다 — 못 닿았으면 던져서 「없음」으로 잘못 기억하지 않게 한다.
 * 요청 제한(429)은 DuplicateCheckLimitedError, 그 밖의 실패는 DuplicateCheckUnavailableError. 가입 요청에서 서버가 다시 막는다.
 */
async function existsOnServer(path: "/email-exists" | "/nickname-exists", payload: unknown) {
  const result = await postAuth(path, payload);
  const limited = tooManyRequestsMessage(result);
  if (limited) throw new DuplicateCheckLimitedError(limited);
  if (!result.ok) throw new DuplicateCheckUnavailableError(result.reason);
  return Boolean(
    typeof result.body === "object" && result.body !== null && "exists" in result.body && result.body.exists,
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

/** { code, message } 오류의 한글 안내. */
function errorMessage(body: unknown): string | undefined {
  const detail = errorDetail(body);
  if (typeof detail !== "object" || detail === null || !("message" in detail)) return undefined;
  return typeof detail.message === "string" ? detail.message : undefined;
}

// 서버에 닿지 못한 응답. 0 은 fetch 실패, 502~504 는 프록시·호스팅이 서버를 못 찾은 경우다.
const SERVER_UNREACHABLE_STATUS: readonly number[] = [0, 502, 503, 504];

/**
 * 시연용 테스트 계정은 개발 서버에서 백엔드를 안 띄워도 들어갈 수 있다(VITE_TEST_ACCOUNT=on 일 때만).
 * 배포본에는 테스트 계정이 없어 이 길이 없다. 다른 계정은 서버 없이 통과시키지 않는다.
 */
function testAccountWithoutServer(email: string, password: string): SessionUser | null {
  if (!TEST_ACCOUNT) return null;
  if (normalizeEmail(email) !== TEST_ACCOUNT.email || password !== TEST_ACCOUNT.password) return null;
  return {
    id: TEST_ACCOUNT.id,
    email: TEST_ACCOUNT.email,
    name: TEST_ACCOUNT.name,
    region: TEST_ACCOUNT.region,
    joinedAt: Date.now(),
    provider: "local",
  };
}

/** 이메일·비밀번호 확인은 서버가 한다. 성공하면 signIn 에 바로 넘길 사용자를 돌려준다. */
export async function authenticate(email: string, password: string): Promise<AuthenticateResult> {
  const result = await postAuth("/login", { email, password });
  if (!result.ok) {
    if (SERVER_UNREACHABLE_STATUS.includes(result.status)) {
      const testUser = testAccountWithoutServer(email, password);
      if (testUser) return { ok: true, user: testUser };
    }
    const limited = tooManyRequestsMessage(result);
    if (limited) return { ok: false, reason: limited };
    // 없는 계정과 틀린 비밀번호를 같은 말로 답해 어떤 메일이 가입됐는지 캐낼 수 없게 한다.
    if (result.status === 401) return { ok: false, reason: "이메일 또는 비밀번호가 올바르지 않습니다." };
    // 422 { code, message } 는 입력 형식 문제다. 통신 오류로 안내하지 않고, 서버 문구도 그대로 띄우지 않는다.
    if (result.status === 422 && errorCode(result.body)) return { ok: false, reason: INPUT_ERROR_MESSAGE };
    return { ok: false, reason: result.reason };
  }
  const user = toSessionUserFromBackend(result.body);
  return user ? { ok: true, user } : { ok: false, reason: SERVER_ERROR_MESSAGE };
}

// 약관 판이 서버와 다르다(409 terms_version_mismatch). 화면을 새로 받아야 새 판으로 보낸다.
const TERMS_CHANGED_MESSAGE = "약관이 바뀌었습니다. 새로고침 뒤 다시 시도해 주세요.";

/** 칸을 짚는 가입 실패. 서버가 code 로 알려 주면 그 칸 옆에 안내를 붙일 수 있다. */
interface FieldFailureRule {
  field: SignUpField;
  reason: string;
  /** 옛 응답은 code 없이 영문 문장만 보낸다. 그 문장도 같은 칸으로 받는다. */
  sentence?: string;
}

// 422 형식 오류는 code 만, 409 중복은 code 와 문장 둘 다 온다(BE 가 {code,message} 로 바꾸는 중 — 문장은 유지).
const SIGNUP_FIELD_FAILURES: Readonly<Record<string, FieldFailureRule>> = {
  invalid_email: { field: "email", reason: "올바른 이메일 형식이 아닙니다." },
  invalid_password: { field: "password", reason: "비밀번호 형식을 확인해 주세요." },
  invalid_nickname: { field: "nickname", reason: "사용할 수 없는 닉네임입니다." },
  email_taken: {
    field: "email",
    reason: "이미 가입된 이메일입니다. 로그인해 주세요.",
    sentence: "Email already registered.",
  },
  nickname_taken: { field: "nickname", reason: "이미 사용 중인 닉네임입니다.", sentence: "Nickname already registered." },
};

/** 오류 본문의 영문 문장. detail 이 문자열이면 그것, { code, message } 면 message 다. */
function errorSentence(body: unknown): string | undefined {
  const detail = errorDetail(body);
  return typeof detail === "string" ? detail : errorMessage(body);
}

/** code 가 있으면 code 로만, 없으면(옛 응답) 문장으로 같은 오류인지 본다. 문장을 안 받는 오류는 code 로만 맞춘다. */
function matchesError(body: unknown, code: string, sentence?: string): boolean {
  const actualCode = errorCode(body);
  if (actualCode) return actualCode === code;
  return sentence !== undefined && errorSentence(body) === sentence;
}

/** 칸을 짚을 수 있는 실패면 그 칸과 안내를, 아니면 undefined. 중복(문장 있는 규칙)은 409 여야 한다. */
function signUpFieldFailure(result: AuthResponse): AccountFailure<SignUpField> | undefined {
  if (result.ok) return undefined;
  for (const [code, rule] of Object.entries(SIGNUP_FIELD_FAILURES)) {
    if (rule.sentence && result.status !== 409) continue;
    if (matchesError(result.body, code, rule.sentence)) return { ok: false, field: rule.field, reason: rule.reason };
  }
  return undefined;
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
    const fieldFailure = signUpFieldFailure(result);
    if (fieldFailure) return fieldFailure;
    if (errorCode(result.body) === "terms_version_mismatch") return { ok: false, reason: TERMS_CHANGED_MESSAGE };
    if (matchesError(result.body, "consent_required", "Required consent is missing.")) {
      return { ok: false, reason: "필수 약관 동의가 빠져 회원가입을 완료하지 못했습니다." };
    }
    const limited = tooManyRequestsMessage(result);
    if (limited) return { ok: false, reason: limited };
    if (SERVER_UNREACHABLE_STATUS.includes(result.status)) {
      return {
        ok: false,
        reason: "가입 서버에 연결하지 못해 회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      };
    }
    if (result.status === 422) return { ok: false, reason: errorMessage(result.body) ?? INPUT_ERROR_MESSAGE };
    return { ok: false, reason: `서버 오류로 회원가입을 완료하지 못했습니다. (오류 ${result.status})` };
  }

  const user = toSessionUserFromBackend(result.body);
  return user ? { ok: true, user } : { ok: false, reason: SERVER_ERROR_MESSAGE };
}
