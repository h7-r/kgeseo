import { normalizeEmail } from "@/services/account/db";

/**
 * 비밀번호 재설정 인증코드 발급·확인. 메일 서버가 붙기 전까지의 흉내라 코드를 화면에 테스트용으로 보여 준다.
 * 탭 안(sessionStorage)에만 두어 탭을 닫으면 사라진다. 서버가 붙으면 이 파일만 바꾸면 된다.
 */
interface PasswordResetState {
  email: string;
  code: string;
  expiresAt: number;
  attempts: number;
  /** 코드를 맞혀야 새 비밀번호 단계가 열린다. */
  verified: boolean;
}

type VerifyCodeResult = { ok: true } | { ok: false; reason: string; field?: "email" | "code" };

const STORAGE_KEY = "waegok.passwordReset";
const CODE_TTL_MS = 10 * 60 * 1000;
// 무작위 대입을 막으려고 이만큼 틀리면 코드를 버린다.
const MAX_ATTEMPTS = 5;

function isResetState(value: unknown): value is PasswordResetState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.email === "string" &&
    typeof state.code === "string" &&
    typeof state.expiresAt === "number" &&
    typeof state.attempts === "number" &&
    typeof state.verified === "boolean"
  );
}

// 모양이 어긋난 값(다른 판의 저장값·손으로 고친 값)은 진행 중인 재설정이 없는 것으로 본다.
function readStoredReset(): PasswordResetState | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    return isResetState(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredReset(state: PasswordResetState | null) {
  try {
    if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장이 막혀도 흐름은 이어 간다.
  }
}

/** 무작위 6자리 코드를 새로 발급한다. 10분 뒤 만료된다. */
export function issueResetCode(email: string): string {
  const number = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(number).padStart(6, "0");
  writeStoredReset({
    email: normalizeEmail(email),
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
    verified: false,
  });
  return code;
}

/** 진행 중인 재설정. 없거나 만료됐으면 null */
export function readResetState(): PasswordResetState | null {
  const state = readStoredReset();
  if (!state) return null;
  if (Date.now() > state.expiresAt) {
    writeStoredReset(null);
    return null;
  }
  return state;
}

export function verifyResetCode(email: string, code: string): VerifyCodeResult {
  const state = readResetState();
  if (!state) return { ok: false, reason: "인증 시간이 지났습니다. 비밀번호 찾기부터 다시 해 주세요." };
  if (state.email !== normalizeEmail(email)) {
    return { ok: false, field: "email", reason: "인증코드를 받은 이메일과 다릅니다." };
  }
  if (state.code !== String(code).trim()) {
    const attempts = state.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      writeStoredReset(null);
      return { ok: false, reason: "인증코드를 5번 틀렸습니다. 비밀번호 찾기부터 다시 해 주세요." };
    }
    writeStoredReset({ ...state, attempts });
    return { ok: false, field: "code", reason: `인증코드가 맞지 않습니다. (${MAX_ATTEMPTS - attempts}번 남음)` };
  }
  writeStoredReset({ ...state, verified: true });
  return { ok: true };
}

/** 재설정을 마치고 코드를 버린다. */
export function clearResetState() {
  writeStoredReset(null);
}
