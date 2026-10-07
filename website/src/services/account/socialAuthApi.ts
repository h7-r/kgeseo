import type { SessionUser } from "@/services/session";

/** 백엔드 단계에서 난 오류. status 가 null 이면 서버에 닿지도 못했다. */
export class BackendAuthError extends Error {
  readonly status: number | null;
  readonly detail: unknown;

  constructor(message: string, status: number | null, detail?: unknown, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackendAuthError";
    this.status = status;
    this.detail = detail;
  }

  /** 409 가 「같은 이메일의 기존 계정에 먼저 로그인해 연결하라」는 뜻인가 */
  get needsAccountLink(): boolean {
    const { detail } = this;
    return (
      this.status === 409 &&
      typeof detail === "object" &&
      detail !== null &&
      "code" in detail &&
      detail.code === "account_link_required"
    );
  }
}

/** /auth/google · /auth/naver 에 보내고 프로필을 받는다. 실패하면 BackendAuthError 를 던진다. */
export async function postSocialAuth(path: "/google" | "/naver", payload: unknown, fallbackMessage: string) {
  let response: Response;
  try {
    response = await fetch(`/api/v1/auth${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new BackendAuthError("Backend에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", null, undefined, { cause });
  }

  const body: unknown = await response.json().catch(() => null);
  const detail = typeof body === "object" && body !== null && "detail" in body ? body.detail : undefined;
  if (!response.ok) {
    const message = typeof detail === "string" && detail ? detail : response.statusText || fallbackMessage;
    throw new BackendAuthError(message, response.status, detail);
  }
  return toSocialProfile(body);
}

export interface SocialProfile {
  provider: string;
  subject: string;
  email: string;
  name?: string | null;
  picture?: string | null;
}

function readText(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null || !(key in body)) return "";
  const value: unknown = Reflect.get(body, key);
  return typeof value === "string" ? value : "";
}

function toSocialProfile(body: unknown): SocialProfile {
  return {
    provider: readText(body, "provider"),
    subject: readText(body, "subject"),
    email: readText(body, "email"),
    name: readText(body, "name") || null,
    picture: readText(body, "picture") || null,
  };
}

/** 소셜 프로필을 세션 모양으로. 이름이 없으면 이메일을 이름으로 쓴다. */
export function toSessionUserFromProfile(profile: SocialProfile, provider = profile.provider): SessionUser {
  return {
    id: `${profile.provider}:${profile.subject}`,
    email: profile.email,
    name: profile.name || profile.email,
    provider,
    picture: profile.picture ?? undefined,
  };
}
