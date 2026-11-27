/**
 * 점검 모드(관리자 API v0.3 3단계 P3-2 (b)). 관리자가 설정에서 켜면 공개 `GET /api/v1/site/status` 가 `maintenance.on` 을 준다.
 * 웹사이트만 점검 화면(/maintenance)으로 보낸다 — 관리자 주소는 예외(점검을 끌 수 있어야 한다), 게임 · API 는 막지 않는다(미르 11/13).
 * 서버에 못 닿으면 점검으로 보지 않는다(사이트가 멈추는 쪽보다 그냥 보이는 쪽이 낫다).
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { apiUrl } from "@/config/env";
import { ROUTES, isAdminRoute } from "@/navigation/routes";

export interface MaintenanceState {
  on: boolean;
  message: string;
}

let cached: MaintenanceState | null = null;
let pending: Promise<MaintenanceState> | null = null;

/** 한 번 읽어 두고 같은 방문 안에선 다시 묻지 않는다. 새로고침하면 다시 읽는다. */
export function readMaintenance(): Promise<MaintenanceState> {
  if (cached) return Promise.resolve(cached);
  pending ??= fetch(apiUrl("/api/v1/site/status"), { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { maintenance?: Partial<MaintenanceState> };
      return { on: Boolean(body.maintenance?.on), message: body.maintenance?.message ?? "" };
    })
    .catch((): MaintenanceState => ({ on: false, message: "" }))
    .then((state) => {
      cached = state;
      pending = null;
      return state;
    });
  return pending;
}

/**
 * 점검 중에도 열어 두는 화면. 점검 화면의 「공지 확인하기」가 고객센터(공지)로 가는데, 거기서 다시 점검 화면으로 튕기면
 * 공지를 볼 수 없었다(11/20 점검). 약관 · 처리방침도 언제든 볼 수 있어야 한다.
 */
const OPEN_DURING_MAINTENANCE: readonly string[] = [ROUTES.maintenance, ROUTES.support, ROUTES.terms];

/** 점검 중이면 점검 화면으로. 화면을 옮길 때마다 다시 본다(읽어 둔 값으로). */
export function useMaintenanceRedirect(): void {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (isAdminRoute(pathname) || OPEN_DURING_MAINTENANCE.includes(pathname)) return;
    let isActive = true;
    readMaintenance().then((state) => {
      if (isActive && state.on) navigate(ROUTES.maintenance, { replace: true, state: { message: state.message } });
    });
    return () => {
      isActive = false;
    };
  }, [pathname, navigate]);
}

/**
 * 관리자가 점검을 켤 때 적은 안내(예: 「17시까지 점검합니다」). 점검 화면으로 넘어올 때 실어 온 값을 먼저 쓰고,
 * 주소를 직접 열었으면 서버 상태에서 읽는다. 없으면 빈 문자열.
 */
export function useMaintenanceMessage(isEnabled = true): string {
  const { state } = useLocation();
  const carried = (state as { message?: unknown } | null)?.message;
  const [message, setMessage] = useState(typeof carried === "string" ? carried : "");
  useEffect(() => {
    // 다른 오류 화면(관리자 500 포함)에서는 서버 상태를 묻지 않는다
    if (!isEnabled || message) return;
    let isActive = true;
    readMaintenance().then((read) => {
      if (isActive && read.on) setMessage(read.message);
    });
    return () => {
      isActive = false;
    };
  }, [isEnabled, message]);
  return isEnabled ? message.trim() : "";
}

/** 시험 · 미리보기용 — 읽어 둔 값을 버린다 */
export function resetMaintenanceCache(): void {
  cached = null;
  pending = null;
}
