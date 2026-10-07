import { run } from "./db";
import { STORE } from "./schema";
import type { LoginAttempt } from "./types";

/*
 * 같은 이메일로 5번 틀리면 5분 잠근다. 없는 이메일도 똑같이 세야 가입 여부가 드러나지 않는다.
 * 브라우저 저장소라 지우면 풀린다 — 진짜 잠금은 서버가 IP·계정 단위로 해야 한다.
 */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 5 * 60 * 1000;

export async function readAttempt(email: string): Promise<LoginAttempt> {
  const attempt = await run(
    STORE.loginAttempts,
    "readonly",
    (store) => store.get(email) as IDBRequest<LoginAttempt | undefined>,
  );
  return attempt ?? { email, failures: 0, lockedUntil: 0 };
}

/** 실패를 하나 더 세고, 다 차면 잠근다. 잠그면 횟수는 0 부터 다시. */
export async function recordFailedLogin(email: string, previousFailures: number) {
  const failures = previousFailures + 1;
  const locked = failures >= MAX_FAILED_LOGINS;
  await run(STORE.loginAttempts, "readwrite", (store) =>
    store.put({ email, failures: locked ? 0 : failures, lockedUntil: locked ? Date.now() + LOCK_DURATION_MS : 0 }),
  );
  return { failures, locked };
}

export const clearLoginAttempts = (email: string) =>
  run(STORE.loginAttempts, "readwrite", (store) => store.delete(email));

export function formatMinutesSeconds(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, "0")}초`;
}
