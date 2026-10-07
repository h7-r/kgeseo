import { emptyAccountData } from "./records";
import { STORE } from "./schema";
import type { AccountRecord } from "./types";

/**
 * 시연용 테스트 계정(TEST / test123@naver.com / test123).
 * 가입 규칙에 안 맞아 가입 화면으로는 만들 수 없고 여기서 직접 심는다. 비밀번호는 해시만 둔다.
 * 실서비스에선 VITE_TEST_ACCOUNT=off 로 반드시 끈다.
 */
export const TEST_ACCOUNT_ENABLED = (import.meta.env.VITE_TEST_ACCOUNT ?? "on") !== "off";

/** 로그인 화면이 시연용으로 미리 채워 두는 값. */
export const TEST_ACCOUNT_LOGIN = { email: "test123@naver.com", password: "test123" } as const;

const TEST_ACCOUNT: AccountRecord = {
  // 팀원 기기마다 같도록 아이디도 고정한다.
  id: "00000000-0000-4000-8000-000000000001",
  email: TEST_ACCOUNT_LOGIN.email,
  socialProvider: null,
  // node 로 미리 계산: pbkdf2("test123", 소금, 210000, sha256)
  passwordHash:
    "pbkdf2_sha256$210000$d08f5a8867fe0f56939831965d2d0fb2$dfbbd540b205077d2a3679355039196f4cf0d30f79def7ede1c099926258c4f7",
  name: "TEST",
  nicknameKey: "test",
  region: "전남",
  joinedAt: Date.UTC(2026, 8, 1),
  isTest: true,
};

export function seedTestAccount(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const transaction = db.transaction([STORE.accounts, STORE.accountData], "readwrite");
    const accounts = transaction.objectStore(STORE.accounts);
    const lookup = accounts.get(TEST_ACCOUNT.email) as IDBRequest<AccountRecord | undefined>;
    lookup.onsuccess = () => {
      if (!TEST_ACCOUNT_ENABLED) {
        // 꺼 두면 전에 심은 것도 치운다. 출시 후 남아 있으면 누구나 로그인할 수 있다.
        if (lookup.result?.isTest) {
          accounts.delete(TEST_ACCOUNT.email);
          transaction.objectStore(STORE.accountData).delete(TEST_ACCOUNT.email);
        }
        return;
      }
      if (lookup.result) return;
      accounts.put(TEST_ACCOUNT);
      transaction.objectStore(STORE.accountData).put(emptyAccountData(TEST_ACCOUNT.email));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}
