import { adminGet, adminSend } from "./client";

/** 관리자 API v0.3 3단계 P3-2 — 설정(값 저장) · 관리자 목록. 점검 적용은 웹사이트가 공개 /site/status 를 읽어서 한다. */
export interface MaintenanceMode {
  on: boolean;
  message: string;
  updated_at: string | null;
  /** 마지막으로 바꾼 관리자 닉네임 */
  updated_by: string | null;
}

export interface AdminSettings {
  editable: { maintenance_mode: MaintenanceMode };
  /** 실행 중 서버의 실제 값(비밀값 없음). 바꾸려면 배포 */
  readonly: Record<string, number | boolean>;
}

export const fetchSettings = (signal?: AbortSignal) => adminGet<AdminSettings>("/api/v1/admin/settings", signal);

/** 기록 `update_setting` 이 남는다. */
export const updateMaintenanceMode = (on: boolean, message: string) =>
  adminSend<MaintenanceMode>("PUT", "/api/v1/admin/settings/maintenance_mode", { on, message });

export interface AdminAccount {
  user_id: string;
  nickname: string;
  /** 서버가 가린 이메일 */
  email: string;
  created_at: string;
  last_login_at: string | null;
  last_session_started_at: string | null;
}

/** 부를 때마다 서버가 「관리자 목록 조회」 한 줄을 남긴다. */
export const fetchAdmins = (signal?: AbortSignal) =>
  adminGet<{ items: AdminAccount[] }>("/api/v1/admin/admins", signal);

/** 읽기 전용 값의 화면 이름 — 모르는 키는 키 이름 그대로 보인다. */
export const READONLY_LABEL: Record<string, string> = {
  hint_initial_balance: "회차 시작 힌트",
  hint_fun_minigames_per_session: "회차당 재미 미니게임",
  hint_special_minigames_per_session: "회차당 특별 미니게임",
  rate_limit_window_sec: "요청 제한 창(초)",
  rate_limit_inquiry_create: "문의 접수 제한(건)",
  rate_limit_inquiry_window_sec: "문의 접수 제한 창(초)",
  beta_events_enabled: "베타 기록 저장",
  user_session_days: "로그인 유지 기간(일)",
  guest_lifetime_days: "게스트 유지 기간(일)",
};
