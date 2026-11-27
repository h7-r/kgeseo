import { normalizeEmail } from "@/services/account/db";

/**
 * 비밀번호 찾기 세 화면이 이어받는 값. 코드는 서버가 메일로만 보내고 여기 두지 않는다.
 * 코드를 맞히면 서버가 준 재설정 증표(10분)를 둔다 — 탭 안(sessionStorage)에만 있어 탭을 닫으면 사라진다.
 */
interface PasswordResetState {
  email: string;
  resetToken: string | null;
  /** 증표가 끝나는 때(ms). 증표가 없으면 0 */
  tokenExpiresAt: number;
  /** 마지막으로 코드를 요청한 때(ms). 서버가 60초에 한 번만 보내므로 「다시 받기」가 이만큼 기다린다 */
  requestedAt: number;
}

const STORAGE_KEY = "waegok.passwordReset";
const TOKEN_TTL_MS = 10 * 60 * 1000;

function isResetState(value: unknown): value is PasswordResetState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.email === "string" &&
    (state.resetToken === null || typeof state.resetToken === "string") &&
    typeof state.tokenExpiresAt === "number" &&
    typeof state.requestedAt === "number"
  );
}

function write(state: PasswordResetState | null) {
  try {
    if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장이 막혀도 흐름은 이어 간다(다음 화면에서 이메일만 다시 적으면 된다).
  }
}

/** 진행 중인 재설정. 모양이 어긋난 값(옛 판 · 손으로 고친 값)은 없는 것으로 본다. 끝난 증표는 지운다. */
export function readResetState(): PasswordResetState | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (!isResetState(value)) return null;
    if (value.resetToken && Date.now() > value.tokenExpiresAt) {
      const expired = { ...value, resetToken: null, tokenExpiresAt: 0 };
      write(expired);
      return expired;
    }
    return value;
  } catch {
    return null;
  }
}

/** ① 코드를 보낸 이메일과 보낸 때를 둔다. 앞서 받은 증표는 버린다. */
export function rememberResetEmail(email: string) {
  write({ email: normalizeEmail(email), resetToken: null, tokenExpiresAt: 0, requestedAt: Date.now() });
}

/** ② 코드를 맞혀 받은 증표를 둔다. */
export function rememberResetToken(email: string, resetToken: string) {
  write({
    email: normalizeEmail(email),
    resetToken,
    tokenExpiresAt: Date.now() + TOKEN_TTL_MS,
    requestedAt: readResetState()?.requestedAt ?? 0,
  });
}

/** 같은 이메일로 코드를 다시 받을 수 있기까지 남은 초(서버의 재발송 대기 60초와 같은 셈). 0 이면 바로 된다 */
export function resendWaitSeconds(email: string, cooldownSec = 60): number {
  const state = readResetState();
  if (!state || state.email !== normalizeEmail(email)) return 0;
  return Math.max(0, Math.ceil((state.requestedAt + cooldownSec * 1000 - Date.now()) / 1000));
}

/** ③ 끝났거나 처음부터 다시 할 때 */
export function clearResetState() {
  write(null);
}

/** 새 비밀번호를 막 저장하고 로그인 화면으로 온 표시(라우터 state). 로그인 화면이 한 번 안내하고 이메일을 채워 둔다. */
export function passwordResetDoneState(email: string) {
  return { passwordResetDone: true, email: normalizeEmail(email) } as const;
}

/** 찾기를 막 마치고 왔으면 그 이메일, 아니면 null */
export function readPasswordResetDone(state: unknown): { email: string } | null {
  if (typeof state !== "object" || state === null) return null;
  const { passwordResetDone, email } = state as { passwordResetDone?: unknown; email?: unknown };
  return passwordResetDone === true ? { email: typeof email === "string" ? email : "" } : null;
}
