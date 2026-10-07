/**
 * 브라우저 안 IndexedDB 로 흉내 낸 회원 DB. 서버가 없으니 진짜 인증이 아니다 —
 * 기기마다 따로 놀고, 그 컴퓨터를 쓰는 사람은 개발자 도구로 열어 볼 수 있다.
 * 백엔드가 붙으면 여기서 내보내는 함수만 서버 호출로 갈아 끼우면 된다. 저장 모양은 ERD(app_user · consent_log)에 맞춰 뒀다.
 *
 * 비밀번호는 계정마다 다른 소금으로 PBKDF2 210,000번 늘린 해시만 남긴다.
 */
export { getAccountData, saveAccountData } from "./account/accountData";
export { authenticate } from "./account/authenticate";
export { changePassword, deleteAccount, exportMyData, resetPassword } from "./account/manageAccount";
export { isEmailTaken, isNicknameTaken, signUp } from "./account/signUp";
export { TEST_ACCOUNT_ENABLED, TEST_ACCOUNT_LOGIN } from "./account/testAccount";
export type { AccountData } from "./account/types";
