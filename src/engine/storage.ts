/**
 * 플레이어 외형 저장 열쇠. 캐릭터 생성 화면이 적고, 본편 로비와 나주 맵이 같은 값을 읽는다.
 * 나주는 본편 안(/naju01/)에서 열리므로 같은 출처의 저장소를 본다 — 열쇠가 하나여야 어디서든 같은 사람이 선다.
 */
export const PLAYER_MESHY_APPEARANCE_KEY = "kgeseo.lobby.meshy.appearance.v1";
export const PLAYER_SIDEKICK_APPEARANCE_KEY = "kgeseo.lobby.sidekick.appearance.v2";

/**
 * localStorage 를 새 열쇠로 읽는다. 새 열쇠가 비어 있으면 이전 열쇠 값을 한 번 복사해 온다.
 * 이전 열쇠는 지우지 않는다 — 아직 그 열쇠를 읽는 코드(나주 맵, 이전 빌드)가 값을 잃지 않게.
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
    // 저장소가 막혀 있으면 지울 것도 없다.
  }
}
