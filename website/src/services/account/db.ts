/**
 * 브라우저 안 계정 저장소(IndexedDB). 가입·로그인·중복 확인은 백엔드가 맡고,
 * 비밀번호 변경·재설정·탈퇴·기록·설정은 아직 서버 API 가 없어 여기에 둔다 — 진짜 인증이 아니다.
 */

import { TEST_ACCOUNT } from "./testAccount";

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

/** 이 계정으로 접수한 1:1 문의 한 건. 문의 API 가 붙기 전까지는 이 브라우저에만 남는다. */
export interface InquiryRecord {
  number: string;
  type: string;
  title: string;
  content: string;
  /** 답변 받을 이메일 */
  email: string;
  attachment: string | null;
  /** 접수 시각(ms) */
  receivedAt: number;
}

/** 계정별 기록·설정. 계정 표와 같은 열쇠(이메일)로 나눠 둔다. */
export interface AccountData {
  email: string;
  records: unknown[];
  settings: AccountSettings;
  /** 최근 로그인 10번 */
  logins?: LoginEntry[];
  /** 접수한 1:1 문의 — 최근 것이 앞 */
  inquiries?: InquiryRecord[];
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
 * 시연용 테스트 계정을 심거나(켜졌을 때) 치운다(꺼졌을 때). 비밀번호는 해시만 둔다.
 * 꺼졌을 때는 이메일을 몰라도 지울 수 있게 isTest 표시로 찾는다 — 배포본에는 테스트 계정 값이 없다.
 */
function seedTestAccount(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const transaction = db.transaction([STORE.accounts, STORE.accountData], "readwrite");
    const accounts = transaction.objectStore(STORE.accounts);
    if (!TEST_ACCOUNT) {
      // 전에 심은 것도 치운다. 남아 있으면 그 기기에선 누구나 그 계정으로 계정 관리 화면을 쓸 수 있다.
      const cursor = accounts.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const account = current.value as AccountRecord;
        if (account.isTest) {
          current.delete();
          transaction.objectStore(STORE.accountData).delete(account.email);
        }
        current.continue();
      };
    } else {
      const testAccount: AccountRecord = {
        id: TEST_ACCOUNT.id,
        email: TEST_ACCOUNT.email,
        socialProvider: null,
        passwordHash: TEST_ACCOUNT.passwordHash,
        name: TEST_ACCOUNT.name,
        nicknameKey: TEST_ACCOUNT.name.toLowerCase(),
        region: TEST_ACCOUNT.region,
        joinedAt: Date.UTC(2026, 8, 1),
        isTest: true,
      };
      const lookup = accounts.get(testAccount.email) as IDBRequest<AccountRecord | undefined>;
      lookup.onsuccess = () => {
        if (lookup.result) return;
        accounts.put(testAccount);
        transaction.objectStore(STORE.accountData).put(emptyAccountData(testAccount.email));
      };
    }
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
