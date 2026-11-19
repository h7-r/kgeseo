import type { AccountFailure } from "./authApi";
import { readAccount, isStorageAvailable, normalizeEmail, runStoreRequest, STORE } from "./db";

/**
 * 비밀번호 변경·재설정은 백엔드 API(BE-4)가 생기면 켠다. 아래 함수들은 이 브라우저 저장소에서만 도는 임시 구현이라,
 * 그전엔 화면에서 「준비 중」으로 막는다(서버 가입자에게는 안 된다 — 보고서 L16).
 * 회원 탈퇴는 서버가 있다(POST /me/withdrawal, #177) — 화면 연동은 미르 승인 뒤(계약 §11). 브라우저 흉내 탈퇴는 뺐다(11/18).
 */
export const IS_ACCOUNT_MANAGEMENT_READY = false;

type ChangePasswordResult = { ok: true } | AccountFailure<"currentPassword" | "newPassword">;
type AccountActionResult = { ok: true } | AccountFailure;

const PBKDF2_ITERATIONS = 210_000;

/** 사생활 보호 모드처럼 IndexedDB 가 막혔을 때 화면에 띄우는 말. 인증 화면도 같은 말을 쓴다. */
export const STORAGE_UNAVAILABLE_REASON =
  "이 브라우저에서는 계정 정보를 쓸 수 없습니다. 사생활 보호 모드를 끄고 다시 시도해 주세요.";

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return toHex(bits);
}

// 알고리즘·반복 횟수를 같이 적어 두면 나중에 횟수를 올려도 이전 해시를 읽을 수 있다.
const formatHash = (saltHex: string, hash: string) => `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${saltHex}$${hash}`;

function parseHash(passwordHash: string) {
  const [, iterations, salt, hash] = passwordHash.split("$");
  return { iterations: Number(iterations), salt, hash };
}

// 끝까지 비교한다. 중간에 멈추면 걸린 시간으로 몇 글자가 맞았는지 샌다.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 로그인한 채로 비밀번호 바꾸기. 자리를 비운 사이 남이 바꾸지 못하게 지금 비밀번호를 먼저 확인한다. */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (!isStorageAvailable()) return { ok: false, reason: STORAGE_UNAVAILABLE_REASON };
  const key = normalizeEmail(email);
  const account = await readAccount(key);
  if (!account) return { ok: false, reason: "계정을 찾을 수 없습니다." };
  if (account.isTest) return { ok: false, reason: "테스트 계정은 비밀번호를 바꿀 수 없습니다." };
  const stored = parseHash(account.passwordHash);
  const hash = await hashPassword(currentPassword, fromHex(stored.salt), stored.iterations);
  if (!constantTimeEqual(hash, stored.hash)) {
    return { ok: false, field: "currentPassword", reason: "현재 비밀번호가 맞지 않습니다." };
  }
  if (currentPassword === newPassword) {
    return { ok: false, field: "newPassword", reason: "현재와 다른 비밀번호를 써 주세요." };
  }
  return resetPassword(key, newPassword);
}

/** 비밀번호 재설정. 가입되지 않은 메일이면 code 가 "unknownEmail" 이다. */
export async function resetPassword(email: string, newPassword: string): Promise<AccountActionResult> {
  if (!isStorageAvailable()) return { ok: false, reason: STORAGE_UNAVAILABLE_REASON };
  const key = normalizeEmail(email);
  const account = await readAccount(key);
  if (!account) return { ok: false, code: "unknownEmail", reason: "가입되지 않은 이메일입니다." };
  if (account.isTest) return { ok: false, reason: "테스트 계정은 비밀번호를 바꿀 수 없습니다." };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(newPassword, salt);
  await runStoreRequest(STORE.accounts, "readwrite", (store) =>
    store.put({ ...account, passwordHash: formatHash(toHex(salt), hash) }),
  );
  return { ok: true };
}
