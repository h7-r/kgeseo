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
