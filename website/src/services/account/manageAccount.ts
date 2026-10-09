import type { SessionUser } from "@/services/session";

import type { AccountFailure } from "./authApi";
import {
  emptyAccountData,
  readAccount,
  isStorageAvailable,
  normalizeEmail,
  runStoreRequest,
  STORE,
  type AccountData,
  type AccountRecord,
  type AccountSettings,
  type ConsentKind,
  type ConsentRecord,
} from "./db";

type ChangePasswordResult = { ok: true } | AccountFailure<"currentPassword" | "newPassword">;
type AccountActionResult = { ok: true } | AccountFailure;

/** 「내 데이터 내려받기」 파일. 사람이 읽는 파일이라 키·값을 한국어로 둔다. */
interface ExportedAccountData {
  내보낸때: string;
  계정: { 아이디: string; 이메일: string; 이름: string; 지역?: string; 가입때?: number; 테스트: boolean };
  설정: Record<string, unknown>;
  플레이기록: unknown[];
  로그인기록: { 때: string; 기기: string }[];
  동의기록: { 종류: string; 판: string; 동의: boolean; 동의때: string; 철회때: string | null }[];
}

const PBKDF2_ITERATIONS = 210_000;

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

// 해시·소금은 절대 밖으로 내보내지 않는다.
const toSessionUser = (account: AccountRecord): SessionUser => ({
  id: account.id,
  email: account.email,
  name: account.name,
  region: account.region,
  joinedAt: account.joinedAt,
  isTest: Boolean(account.isTest),
});

/** 이 계정의 기록·설정 읽기 */
export async function readAccountData(email: string): Promise<AccountData | null> {
  if (!isStorageAvailable()) return null;
  const data = await runStoreRequest(
    STORE.accountData,
    "readonly",
    (store) => store.get(normalizeEmail(email)) as IDBRequest<AccountData | undefined>,
  );
  return data ?? null;
}

/** 이 계정의 데이터 쓰기. 넘긴 항목만 덮어쓴다. */
export async function writeAccountData(
  email: string,
  patch: Partial<Omit<AccountData, "email">>,
): Promise<AccountData | null> {
  if (!isStorageAvailable()) return null;
  const key = normalizeEmail(email);
  const current = (await readAccountData(key)) ?? emptyAccountData(key);
  const next: AccountData = { ...current, ...patch, email: key };
  await runStoreRequest(STORE.accountData, "readwrite", (store) => store.put(next));
  return next;
}

const readConsents = (accountId: string) =>
  runStoreRequest(
    STORE.consents,
    "readonly",
    (store) => store.index("accountId").getAll(accountId) as IDBRequest<ConsentRecord[]>,
  );

/** 탈퇴해도 동의 기록은 지우지 않고 철회 시각만 남긴다. */
async function withdrawConsents(accountId: string) {
  const consents = await readConsents(accountId);
  for (const consent of consents) {
    await runStoreRequest(STORE.consents, "readwrite", (store) =>
      store.put({ ...consent, withdrawnAt: consent.withdrawnAt ?? Date.now() }),
    );
  }
}

/** 로그인한 채로 비밀번호 바꾸기. 자리를 비운 사이 남이 바꾸지 못하게 지금 비밀번호를 먼저 확인한다. */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (!isStorageAvailable()) return { ok: false, reason: "저장소를 쓸 수 없습니다." };
  const key = normalizeEmail(email);
  const account = await readAccount(key);
  if (!account) return { ok: false, reason: "계정을 찾을 수 없습니다." };
  if (account.isTest) return { ok: false, reason: "테스트 계정은 비밀번호를 바꿀 수 없습니다." };
  const stored = parseHash(account.passwordHash);
  const hash = await hashPassword(currentPassword, fromHex(stored.salt), stored.iterations);
  if (!constantTimeEqual(hash, stored.hash)) {
    return { ok: false, field: "currentPassword", reason: "지금 비밀번호가 맞지 않습니다." };
  }
  if (currentPassword === newPassword) {
    return { ok: false, field: "newPassword", reason: "지금과 다른 비밀번호를 써 주세요." };
  }
  return resetPassword(key, newPassword);
}

/** 비밀번호 재설정. 가입되지 않은 메일이면 code 가 "unknownEmail" 이다. */
export async function resetPassword(email: string, newPassword: string): Promise<AccountActionResult> {
  if (!isStorageAvailable()) return { ok: false, reason: "저장소를 쓸 수 없습니다." };
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

// 저장은 영어 키로 하지만 내려받는 파일은 사람이 읽는 것이라 한국어 키·값으로 바꿔 내보낸다.
const SETTING_LABELS: Record<keyof AccountSettings, string> = {
  emailNotifications: "메일수신",
  launchAlertPlan: "오픈알림",
  launchAlertAt: "오픈알림때",
};
const SETTING_LABEL_MAP = new Map<string, string>(Object.entries(SETTING_LABELS));

const CONSENT_LABELS: Record<ConsentKind, string> = {
  terms: "이용약관",
  privacyCollection: "개인정보수집",
  over14: "만14세이상",
};

/** 내 데이터 내려받기. 계정 정보 · 기록 · 설정 · 동의 이력(해시·소금은 빼고) */
export async function exportMyData(email: string): Promise<ExportedAccountData | null> {
  if (!isStorageAvailable()) return null;
  const key = normalizeEmail(email);
  const account = await readAccount(key);
  if (!account) return null;
  const data = await readAccountData(key);
  const consents = await readConsents(account.id);
  const user = toSessionUser(account);
  return {
    내보낸때: new Date().toISOString(),
    계정: {
      아이디: user.id,
      이메일: user.email,
      이름: user.name,
      지역: user.region,
      가입때: user.joinedAt,
      테스트: Boolean(user.isTest),
    },
    설정: Object.fromEntries(
      Object.entries(data?.settings ?? {}).map(([name, value]) => [SETTING_LABEL_MAP.get(name) ?? name, value]),
    ),
    플레이기록: data?.records ?? [],
    로그인기록: (data?.logins ?? []).map((entry) => ({ 때: new Date(entry.at).toISOString(), 기기: entry.device })),
    동의기록: consents.map(({ kind, version, agreed, agreedAt, withdrawnAt }) => ({
      종류: CONSENT_LABELS[kind],
      판: version,
      동의: agreed,
      동의때: new Date(agreedAt).toISOString(),
      철회때: withdrawnAt ? new Date(withdrawnAt).toISOString() : null,
    })),
  };
}

/** 탈퇴. 계정과 그 계정의 데이터를 지우고, 동의 기록은 지우지 않고 철회로 남긴다. */
export async function deleteAccount(email: string): Promise<AccountActionResult> {
  if (!isStorageAvailable()) return { ok: false, reason: "저장소를 쓸 수 없습니다." };
  const key = normalizeEmail(email);
  const account = await readAccount(key);
  if (account?.id) await withdrawConsents(account.id);
  await runStoreRequest(STORE.accounts, "readwrite", (store) => store.delete(key));
  await runStoreRequest(STORE.accountData, "readwrite", (store) => store.delete(key));
  return { ok: true };
}
