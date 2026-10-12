import type { SessionUser } from "@/services/session";

import { errorCode, toSessionUserFromBackend } from "./authApi";
import type { ConsentKind } from "./db";

export type SocialProvider = "google" | "naver";

const PROVIDER_LABEL: Record<SocialProvider, string> = { google: "Google", naver: "네이버" };

/** 백엔드 단계에서 난 오류. status 가 null 이면 서버에 닿지도 못했다. code 는 detail.code 가 있을 때만. */
export class BackendAuthError extends Error {
  readonly status: number | null;
  readonly code: string | undefined;

  constructor(status: number | null, code?: string, options?: ErrorOptions) {
    super(`backend auth error ${status ?? "network"}${code ? ` ${code}` : ""}`, options);
    this.name = "BackendAuthError";
    this.status = status;
    this.code = code;
  }
}

/** 처음 온 소셜 계정. 닉네임·동의를 받아 가입을 마쳐야 로그인된다. */
export interface OnboardingRequired {
  provider: SocialProvider;
  /** 가입 완료 요청에 한 번 쓰는 증표. 저장소·주소에 남기지 않고 메모리로만 넘긴다. */
  token: string;
  suggestedNickname: string;
  /** 서버가 정한 약관 판. 화면에 상수로 두지 않고 받은 값을 그대로 돌려보낸다. */
  termsVersion: string;
  /** 증표가 끝나는 때(ms). 서버의 expires_in 으로 계산한다. */
  expiresAt: number;
}

export type SocialAuthResult =
  { kind: "signedIn"; user: SessionUser } | { kind: "onboardingRequired"; onboarding: OnboardingRequired };

async function postJson(path: string, payload: unknown): Promise<{ status: number; ok: boolean; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/auth${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new BackendAuthError(null, undefined, { cause });
  }
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

function toOnboardingRequired(provider: SocialProvider, body: unknown): OnboardingRequired | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if (
    value.result !== "onboarding_required" ||
    typeof value.onboarding_token !== "string" ||
    !value.onboarding_token ||
    typeof value.expires_in !== "number" ||
    value.expires_in <= 0 ||
    typeof value.suggested_nickname !== "string" ||
    typeof value.terms_version !== "string" ||
    !value.terms_version
  ) {
    return null;
  }
  return {
    provider,
    token: value.onboarding_token,
    suggestedNickname: value.suggested_nickname,
    termsVersion: value.terms_version,
    expiresAt: Date.now() + value.expires_in * 1000,
  };
}

/**
 * /auth/google · /auth/naver 에 보낸다. 기존 회원이면 로그인할 사용자, 처음이면 가입 안내를 돌려준다.
 * 두 응답은 result 키로 먼저 가른다. 실패하면 BackendAuthError 를 던진다.
 */
export async function postSocialAuth(provider: SocialProvider, payload: unknown): Promise<SocialAuthResult> {
  const { status, ok, body } = await postJson(`/${provider}`, payload);
  if (!ok) throw new BackendAuthError(status, errorCode(body));
  if (typeof body === "object" && body !== null && "result" in body) {
    const onboarding = toOnboardingRequired(provider, body);
    if (onboarding) return { kind: "onboardingRequired", onboarding };
  } else {
    const user = toSessionUserFromBackend(body);
    if (user) return { kind: "signedIn", user };
  }
  // 성공 상태인데 약속한 모양이 아니면 빈 사용자로 로그인시키지 않는다.
  throw new BackendAuthError(status);
}

/** 소셜 가입을 마친다. 성공하면 바로 로그인할 사용자, 실패하면 BackendAuthError. */
export async function completeSocialOnboarding(
  onboarding: OnboardingRequired,
  nickname: string,
  consents: Record<ConsentKind, boolean>,
): Promise<SessionUser> {
  // 서버는 이 필드만 받는다. 지역 같은 다른 칸을 보내면 422 다.
  const { status, ok, body } = await postJson("/social-onboarding/complete", {
    onboarding_token: onboarding.token,
    nickname,
    terms_version: onboarding.termsVersion,
    consent: { terms: consents.terms, privacy: consents.privacyCollection, age: consents.over14 },
  });
  if (!ok) throw new BackendAuthError(status, errorCode(body));
  const user = toSessionUserFromBackend(body);
  if (!user) throw new BackendAuthError(status);
  return user;
}

// 가입 증표는 이 모듈 변수에만 둔다. 저장소·주소·history.state 에 남기지 않아 새로고침하면 사라진다.
let pendingOnboarding: (OnboardingRequired & { returnTo: string | null }) | null = null;

/** 가입 화면으로 넘기기 전에 증표를 맡긴다. returnTo 는 가입을 마친 뒤 돌아갈 사이트 안 주소. */
export function holdOnboarding(onboarding: OnboardingRequired, returnTo: string | null = null) {
  pendingOnboarding = { ...onboarding, returnTo };
}

export function readOnboarding() {
  return pendingOnboarding;
}

export function clearOnboarding() {
  pendingOnboarding = null;
}

export const ACCOUNT_LINK_MESSAGE = "이미 다른 방법으로 가입된 이메일입니다. 처음 가입한 방법으로 로그인해 주세요.";
export const CONNECTION_ERROR_MESSAGE = "로그인 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
export const ONBOARDING_RESTART_MESSAGE = "로그인 시간이 만료되었습니다. 소셜 로그인을 다시 진행해 주세요.";

/** 키가 없거나 서버 설정 전(503). 환경변수 이름은 화면에 내지 않는다. */
export function socialNotReadyMessage(provider: SocialProvider): string {
  return `${PROVIDER_LABEL[provider]} 로그인을 준비하고 있습니다. 지금은 이메일로 이용해 주세요.`;
}

/** provider 가 준 값(구글 credential · 네이버 code/state)이 쓸 수 없을 때. */
export function socialInvalidResponseMessage(provider: SocialProvider): string {
  return provider === "google"
    ? "Google 로그인 정보를 받지 못했습니다. 다시 시도해 주세요."
    : "네이버 로그인 응답이 올바르지 않습니다. 처음부터 다시 시도해 주세요.";
}

/** /auth/google · /auth/naver 실패를 화면 문구로. 서버의 영문 detail 은 쓰지 않고 status·code 로 고른다. */
export function socialAuthErrorMessage(provider: SocialProvider, error: BackendAuthError): string {
  if (error.status === null) return CONNECTION_ERROR_MESSAGE;
  if (error.code === "account_link_required") return ACCOUNT_LINK_MESSAGE;
  if (error.status === 503) return socialNotReadyMessage(provider);
  if (error.status === 401 || error.status === 422) return socialInvalidResponseMessage(provider);
  if (error.status === 502)
    return `${PROVIDER_LABEL[provider]} 계정 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.`;
  return `${PROVIDER_LABEL[provider]} 로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.`;
}

/**
 * 가입 완료 실패를 화면 동작으로. restart 는 증표를 버리고 소셜 로그인부터,
 * nickname 은 같은 화면에서 닉네임만 다시, retry 는 같은 화면에서 다시 누르게 한다.
 */
export function onboardingFailure(error: BackendAuthError): {
  action: "restart" | "nickname" | "retry";
  message: string;
} {
  switch (error.code) {
    case "invalid_onboarding_token":
    case "onboarding_token_used":
    case "terms_version_mismatch":
      return { action: "restart", message: ONBOARDING_RESTART_MESSAGE };
    case "account_link_required":
      return { action: "restart", message: ACCOUNT_LINK_MESSAGE };
    case "invalid_nickname":
      return { action: "nickname", message: "사용할 수 없는 닉네임입니다. 다른 닉네임을 입력해 주세요." };
    case "nickname_unavailable":
      return { action: "nickname", message: "이미 사용 중인 닉네임입니다." };
    case "consent_required":
      return { action: "retry", message: "필수 약관에 모두 동의해 주세요." };
    case "invalid_input":
      return { action: "retry", message: "입력값을 다시 확인해 주세요." };
  }
  if (error.status === null) return { action: "retry", message: CONNECTION_ERROR_MESSAGE };
  return { action: "retry", message: "가입을 마치지 못했습니다. 잠시 후 다시 시도해 주세요." };
}
