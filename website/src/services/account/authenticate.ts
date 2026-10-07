import { postAuth, toSessionUserFromBackend } from "./authApi";
import type { AuthenticateResult } from "./types";

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
