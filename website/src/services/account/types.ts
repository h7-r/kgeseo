import type { SessionUser } from "@/services/session";

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

export interface LoginEntry {
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

/** 화면이 문구 대신 비교할 실패 종류 */
export type AccountFailureCode = "unknownEmail";

export type AccountFailure<Field extends string = never> = {
  ok: false;
  reason: string;
  code?: AccountFailureCode;
  /** 문제가 난 입력칸 */
  field?: Field;
};

export type SignUpResult = { ok: true; user: SessionUser } | AccountFailure<"email" | "nickname">;
export type AuthenticateResult = { ok: true; user: SessionUser } | AccountFailure;
export type ChangePasswordResult = { ok: true } | AccountFailure<"currentPassword" | "newPassword">;
export type AccountActionResult = { ok: true } | AccountFailure;

export interface SignUpInput {
  email: string;
  password: string;
  nickname?: string;
  region?: string;
  consents?: Partial<Record<ConsentKind, boolean>>;
}

/** 「내 데이터 내려받기」 파일. 사람이 읽는 파일이라 키·값을 한국어로 둔다. */
export interface ExportedAccountData {
  내보낸때: string;
  계정: { 아이디: string; 이메일: string; 이름: string; 지역?: string; 가입때?: number; 테스트: boolean };
  설정: Record<string, unknown>;
  플레이기록: unknown[];
  로그인기록: { 때: string; 기기: string }[];
  동의기록: { 종류: string; 판: string; 동의: boolean; 동의때: string; 철회때: string | null }[];
}
