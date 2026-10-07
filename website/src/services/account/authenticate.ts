import { recordLogin } from "./accountData";
import { getAccount, isStorageAvailable } from "./db";
import {
  clearLoginAttempts,
  formatMinutesSeconds,
  LOCK_DURATION_MS,
  MAX_FAILED_LOGINS,
  readAttempt,
  recordFailedLogin,
} from "./loginLock";
import { constantTimeEqual, fromHex, hashPassword, parseHash, PBKDF2_ITERATIONS } from "./passwordHash";
import { normalizeEmail, toSessionUser } from "./records";
import type { AuthenticateResult } from "./types";

// 없는 계정도 해시를 똑같이 한 번 돌린다. 안 그러면 응답 시간만으로 가입 여부가 드러난다.
const DUMMY_SALT = new Uint8Array(16);

/** 이메일·비밀번호 확인. 성공하면 signIn 에 바로 넘길 사용자를 돌려준다. */
export async function authenticate(email: string, password: string): Promise<AuthenticateResult> {
  if (!isStorageAvailable()) return { ok: false, reason: "이 브라우저에서는 계정을 읽을 수 없습니다." };
  const key = normalizeEmail(email);

  const attempt = await readAttempt(key);
  if (attempt.lockedUntil > Date.now()) {
    return {
      ok: false,
      lockedUntil: attempt.lockedUntil,
      reason: `로그인을 ${MAX_FAILED_LOGINS}번 실패해 잠시 잠겼습니다. ${formatMinutesSeconds(attempt.lockedUntil - Date.now())} 뒤에 다시 시도해 주세요.`,
    };
  }

  const account = await getAccount(key);
  const stored = account ? parseHash(account.passwordHash) : null;
  const hash = await hashPassword(
    password,
    stored ? fromHex(stored.salt) : DUMMY_SALT,
    stored?.iterations ?? PBKDF2_ITERATIONS,
  );

  if (!account || !stored || !constantTimeEqual(hash, stored.hash)) {
    const { failures, locked } = await recordFailedLogin(key, attempt.failures);
    // 없는 계정과 틀린 비밀번호를 같은 말로 답해 어떤 메일이 가입됐는지 캐낼 수 없게 한다.
    if (locked) {
      return {
        ok: false,
        lockedUntil: Date.now() + LOCK_DURATION_MS,
        reason: `로그인을 ${MAX_FAILED_LOGINS}번 실패해 5분 동안 잠깁니다.`,
      };
    }
    const remaining = MAX_FAILED_LOGINS - failures;
    return {
      ok: false,
      reason: `이메일 또는 비밀번호가 올바르지 않습니다.${failures >= 3 ? ` (${remaining}번 더 틀리면 5분간 잠깁니다)` : ""}`,
    };
  }

  await clearLoginAttempts(key);
  await recordLogin(key);
  return { ok: true, user: toSessionUser(account) };
}
