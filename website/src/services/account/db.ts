/**
 * 계정 화면이 함께 쓰는 작은 값. 가입 · 로그인 · 비밀번호 찾기 · 변경 · 탈퇴는 모두 서버가 맡는다.
 * 이 파일에 있던 브라우저 안 계정 저장소(IndexedDB 흉내)는 비밀번호 기능이 서버로 옮겨 가며 지웠다(11/25).
 */

/** 가입 때 받는 동의 종류 */
export type ConsentKind = "terms" | "privacyCollection" | "over14";

/** 서버와 같은 셈으로 다듬은 이메일(NFC · 앞뒤 공백 · 소문자) */
export const normalizeEmail = (email: unknown) =>
  String(email || "")
    .normalize("NFC")
    .trim()
    .toLowerCase();

/**
 * 옛 브라우저 계정 저장소(IndexedDB)를 지운다. 비밀번호 변경 · 찾기 흉내가 PBKDF2 해시 · 계정 기록을 여기 두었는데, 서버로 옮긴 뒤
 * (11/25) 아무도 열지 않아 그대로 남았다 — 탈퇴 계약 §11 「브라우저 저장소의 계정 값 정리」 취지대로 부팅 때 거둔다.
 * 없는 DB 를 지우는 것은 아무 일도 하지 않는다. 막힌 브라우저(사생활 보호 등)에서는 조용히 넘어간다.
 */
export function forgetOldBrowserAccountStore(): void {
  try {
    if (typeof indexedDB === "undefined") return;
    for (const name of ["waegok-accounts", "왜곡계정"]) indexedDB.deleteDatabase(name);
  } catch {
    // 저장소를 못 쓰는 브라우저 — 지울 것도 없다
  }
}
