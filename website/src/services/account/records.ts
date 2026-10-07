import type { SessionUser } from "@/services/session";

import type { AccountData, AccountRecord } from "./types";

export const normalizeEmail = (email: unknown) =>
  String(email || "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
// 해시·소금은 절대 밖으로 내보내지 않는다. 이 모양 그대로 signIn 에 넘길 수 있다.
export const toSessionUser = (account: AccountRecord): SessionUser => ({
  id: account.id,
  email: account.email,
  name: account.name,
  region: account.region,
  joinedAt: account.joinedAt,
  isTest: Boolean(account.isTest),
});

export const emptyAccountData = (email: string): AccountData => ({ email, records: [], settings: {} });
