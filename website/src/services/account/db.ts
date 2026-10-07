import { createSchema, DB_NAME, DB_VERSION, LEGACY_DB_NAME, STORE, type StoreName } from "./schema";
import { seedTestAccount } from "./testAccount";
import type { AccountRecord } from "./types";

// 사생활 보호 모드에서는 막히기도 한다.
export function isStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

let openPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
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
export async function run<T>(
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

export const getAccount = (email: string) =>
  run(STORE.accounts, "readonly", (store) => store.get(email) as IDBRequest<AccountRecord | undefined>);
