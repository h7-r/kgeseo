/**
 * localStorage 를 새 열쇠로 읽는다. 새 열쇠가 비어 있으면 옛 열쇠 값을 한 번 복사해 온다.
 * 옛 열쇠는 지우지 않는다 — 아직 옛 열쇠를 읽는 코드(나주 맵, 이전 빌드)가 값을 잃지 않게.
 * 저장소가 막힌 환경(사생활 보호 등)에서는 null.
 */
export function readMigrated(key: string, legacyKey: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return null;
    localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}

/** 저장소가 막힌 환경에서는 null. */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 공간이 없거나 막혀 있으면 조용히 넘어간다.
  }
}

export function removeStorage(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 무시
  }
}
