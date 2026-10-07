export const DB_NAME = "waegok-accounts";
/** 한글 이름을 쓰던 이전 판의 DB. 로컬 시연용 계정뿐이라 옮기지 않고 지운다. */
export const LEGACY_DB_NAME = "왜곡계정";
export const DB_VERSION = 2;

export const STORE = {
  accounts: "accounts",
  accountData: "accountData",
  consents: "consents",
  loginAttempts: "loginAttempts",
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

/**
 * 이 DB 는 이전 판에서 올라오는 경로가 없어 표·색인을 한 번에 만든다.
 * contains 검사가 있어 다음 판을 올릴 때도 이 블록을 그대로 쓸 수 있다.
 */
export function createSchema(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE.accounts)) {
    const accounts = db.createObjectStore(STORE.accounts, { keyPath: "email" });
    // 화면에서 미리 막아도, 두 탭에서 동시에 가입하는 경우까지 막아 주는 마지막 벽이다.
    accounts.createIndex("nicknameKey", "nicknameKey", { unique: true });
  }
  if (!db.objectStoreNames.contains(STORE.accountData)) {
    db.createObjectStore(STORE.accountData, { keyPath: "email" });
  }
  if (!db.objectStoreNames.contains(STORE.consents)) {
    const consents = db.createObjectStore(STORE.consents, { keyPath: "id" });
    consents.createIndex("accountId", "accountId");
  }
  if (!db.objectStoreNames.contains(STORE.loginAttempts)) {
    db.createObjectStore(STORE.loginAttempts, { keyPath: "email" });
  }
}
