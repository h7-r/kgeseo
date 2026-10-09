/**
 * 브라우저 안 계정 저장소(IndexedDB). 가입·로그인·중복 확인은 백엔드가 맡고,
 * 비밀번호 변경·재설정·탈퇴·기록·설정은 아직 서버 API 가 없어 여기에 둔다 — 진짜 인증이 아니다.
 */

const DB_NAME = "waegok-accounts";
/** 한글 이름을 쓰던 이전 판의 DB. 로컬 시연용 계정뿐이라 옮기지 않고 지운다. */
const LEGACY_DB_NAME = "왜곡계정";
const DB_VERSION = 2;

export const STORE = {
  accounts: "accounts",
  accountData: "accountData",
  consents: "consents",
  loginAttempts: "loginAttempts",
} as const;

type StoreName = (typeof STORE)[keyof typeof STORE];

/** ERD app_user 와 같은 칸. region·isTest 는 ERD 에 없는 화면용 칸이다. */
export interface AccountRecord {
  id: string;
  /** 소문자로 다듬은 값. 저장소의 열쇠다. */
  email: string;
  socialProvider: string | null;
  /** "pbkdf2_sha256$반복$소금$해시" 한 줄 */
  passwordHash: string;
  name: string;
  /** 닉네임 겹침 검사용 소문자 값. 고유 색인이 걸려 있다. */
  nicknameKey: string;
  region: string;
  joinedAt: number;
  isTest: boolean;
}

interface LoginEntry {
  at: number;
  /** "Chrome · macOS" 같은 브라우저·기기 이름 */
  device: string;
}

export interface AccountSettings {
  emailNotifications?: boolean;
  /** 오픈 알림을 신청한 플랜 이름 */
  launchAlertPlan?: string;
  launchAlertAt?: number;
}

/** 계정별 기록·설정. 계정 표와 같은 열쇠(이메일)로 나눠 둔다. */
export interface AccountData {
  email: string;
  records: unknown[];
  settings: AccountSettings;
  /** 최근 로그인 10번 */
  logins?: LoginEntry[];
}

export type ConsentKind = "terms" | "privacyCollection" | "over14";

export interface ConsentRecord {
  id: string;
  accountId: string;
  kind: ConsentKind;
  version: string;
  agreed: boolean;
  agreedAt: number;
  withdrawnAt: number | null;
}

export const normalizeEmail = (email: unknown) =>
  String(email || "")
    .normalize("NFC")
    .trim()
    .toLowerCase();

export const emptyAccountData = (email: string): AccountData => ({ email, records: [], settings: {} });

/**
 * 이 DB 는 이전 판에서 올라오는 경로가 없어 표·색인을 한 번에 만든다.
 * contains 검사가 있어 다음 판을 올릴 때도 이 블록을 그대로 쓸 수 있다.
 */
function createSchema(db: IDBDatabase) {
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
  // pbkdf2("test123", 소금, 210000, sha256)
  passwordHash:
    "pbkdf2_sha256$210000$d08f5a8867fe0f56939831965d2d0fb2$dfbbd540b205077d2a3679355039196f4cf0d30f79def7ede1c099926258c4f7",
  name: "TEST",
  nicknameKey: "test",
  region: "전남",
  joinedAt: Date.UTC(2026, 8, 1),
  isTest: true,
};

function seedTestAccount(db: IDBDatabase): Promise<void> {
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

// 사생활 보호 모드에서는 막히기도 한다.
export function isStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

let openPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  // 이전 판 DB 에 남은 비밀번호 해시를 치운다. 없으면 아무 일도 일어나지 않는다.
  try {
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {
    // 못 지워도 새 DB 는 열어야 한다.
  }
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => createSchema(request.result);
    request.onsuccess = async () => {
      const db = request.result;
      // 다른 탭이 더 새 판으로 열면 닫아 준다. 안 닫으면 그쪽 업그레이드가 멈춘다.
      db.onversionchange = () => {
        db.close();
        openPromise = null;
      };
      try {
        await seedTestAccount(db);
      } catch {
        // 테스트 계정을 못 심어도 저장소는 써야 한다.
      }
      resolve(db);
    };
    request.onerror = () => {
      openPromise = null;
      reject(request.error);
    };
  });
  return openPromise;
}

/** 표 하나에 요청 하나를 보내고 결과를 기다린다. */
export async function runStoreRequest<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const readAccount = (email: string) =>
  runStoreRequest(STORE.accounts, "readonly", (store) => store.get(email) as IDBRequest<AccountRecord | undefined>);
