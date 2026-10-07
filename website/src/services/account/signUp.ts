import { errorCode, errorDetail, existsOnServer, postAuth, toSessionUserFromBackend } from "./authApi";
import { TERMS_VERSION } from "./consents";
import { normalizeEmail } from "./records";
import type { SignUpInput, SignUpResult } from "./types";

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
