import { run } from "./db";
import { STORE } from "./schema";
import type { ConsentRecord } from "./types";

// 약관 글이 바뀌면 올린다. 동의 기록에 함께 남아 어느 판에 동의했는지 알 수 있다(consent_log.version).
export const TERMS_VERSION = "2026-09";

export const getConsents = (accountId: string) =>
  run(STORE.consents, "readonly", (store) => store.index("accountId").getAll(accountId) as IDBRequest<ConsentRecord[]>);

/** 탈퇴해도 동의 기록은 지우지 않고 철회 시각만 남긴다. */
export async function withdrawConsents(accountId: string) {
  const consents = await getConsents(accountId);
  for (const consent of consents) {
    await run(STORE.consents, "readwrite", (store) =>
      store.put({ ...consent, withdrawnAt: consent.withdrawnAt ?? Date.now() }),
    );
  }
}
