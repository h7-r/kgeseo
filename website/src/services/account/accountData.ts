import { isStorageAvailable, run } from "./db";
import { emptyAccountData, normalizeEmail } from "./records";
import { STORE } from "./schema";
import type { AccountData } from "./types";

/** 이 계정의 기록·설정 읽기 */
export async function getAccountData(email: string): Promise<AccountData | null> {
  if (!isStorageAvailable()) return null;
  const data = await run(
    STORE.accountData,
    "readonly",
    (store) => store.get(normalizeEmail(email)) as IDBRequest<AccountData | undefined>,
  );
  return data ?? null;
}

/** 이 계정의 데이터 쓰기. 넘긴 항목만 덮어쓴다. */
export async function saveAccountData(
  email: string,
  patch: Partial<Omit<AccountData, "email">>,
): Promise<AccountData | null> {
  if (!isStorageAvailable()) return null;
  const key = normalizeEmail(email);
  const current = (await getAccountData(key)) ?? emptyAccountData(key);
  const next: AccountData = { ...current, ...patch, email: key };
  await run(STORE.accountData, "readwrite", (store) => store.put(next));
  return next;
}

function describeDevice(): string {
  const ua = navigator.userAgent || "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "브라우저";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "기기";
  return `${browser} · ${os}`;
}

// 「내가 모르는 로그인이 있었나」를 스스로 확인하는 용도. IP 는 브라우저가 알 수 없어 서버 몫이다.
export async function recordLogin(email: string) {
  try {
    const current = (await getAccountData(email)) ?? emptyAccountData(email);
    const logins = [{ at: Date.now(), device: describeDevice() }, ...(current.logins ?? [])].slice(0, 10);
    await run(STORE.accountData, "readwrite", (store) => store.put({ ...current, logins }));
  } catch {
    // 기록을 못 남겨도 로그인은 되어야 한다.
  }
}
