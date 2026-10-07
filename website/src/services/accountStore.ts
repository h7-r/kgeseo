/**
 * 계정. 가입·로그인·중복 확인은 백엔드(/api/v1/auth)가 맡는다.
 * 비밀번호 변경·재설정·탈퇴·기록·설정은 아직 서버 API 가 없어 브라우저 안 IndexedDB 에 둔다 — 진짜 인증이 아니다.
 */
export { getAccountData, saveAccountData } from "./account/accountData";
export { authenticate } from "./account/authenticate";
export { changePassword, deleteAccount, exportMyData, resetPassword } from "./account/manageAccount";
export { isEmailTaken, isNicknameTaken, signUp } from "./account/signUp";
export { TEST_ACCOUNT_ENABLED, TEST_ACCOUNT_LOGIN } from "./account/testAccount";
export type { AccountData } from "./account/types";
