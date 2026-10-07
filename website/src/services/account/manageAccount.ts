import { getAccountData } from "./accountData";
import { getConsents, withdrawConsents } from "./consents";
import { getAccount, isStorageAvailable, run } from "./db";
import { clearLoginAttempts } from "./loginLock";
import { constantTimeEqual, formatHash, fromHex, hashPassword, parseHash, toHex } from "./passwordHash";
import { normalizeEmail, toSessionUser } from "./records";
import { STORE } from "./schema";
import type {
  AccountActionResult,
  AccountSettings,
  ChangePasswordResult,
  ConsentKind,
  ExportedAccountData,
} from "./types";

/** 로그인한 채로 비밀번호 바꾸기. 자리를 비운 사이 남이 바꾸지 못하게 지금 비밀번호를 먼저 확인한다. */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (!isStorageAvailable()) return { ok: false, reason: "저장소를 쓸 수 없습니다." };
  const key = normalizeEmail(email);
  const account = await getAccount(key);
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
  const account = await getAccount(key);
  if (!account) return { ok: false, code: "unknownEmail", reason: "가입되지 않은 이메일입니다." };
  if (account.isTest) return { ok: false, reason: "테스트 계정은 비밀번호를 바꿀 수 없습니다." };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(newPassword, salt);
  await run(STORE.accounts, "readwrite", (store) =>
    store.put({ ...account, passwordHash: formatHash(toHex(salt), hash) }),
  );
  // 새 비밀번호로 바로 들어올 수 있게 로그인 잠금도 푼다.
  await clearLoginAttempts(key);
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
  const account = await getAccount(key);
  if (!account) return null;
  const data = await getAccountData(key);
  const consents = await getConsents(account.id);
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
  const account = await getAccount(key);
  if (account?.id) await withdrawConsents(account.id);
  await run(STORE.accounts, "readwrite", (store) => store.delete(key));
  await run(STORE.accountData, "readwrite", (store) => store.delete(key));
  // 같은 메일로 다시 가입한 사람이 지난 잠금을 물려받지 않게 한다.
  await clearLoginAttempts(key);
  return { ok: true };
}
