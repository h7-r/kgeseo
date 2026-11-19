/**
 * 점검 모드(관리자 API v0.3 3단계 P3-2 (b)). 관리자가 설정에서 켜면 공개 `GET /api/v1/site/status` 가 `maintenance.on` 을 준다.
 * 웹사이트만 점검 화면(/maintenance)으로 보낸다 — 관리자 주소는 예외(점검을 끌 수 있어야 한다), 게임 · API 는 막지 않는다(미르 11/13).
 * 서버에 못 닿으면 점검으로 보지 않는다(사이트가 멈추는 쪽보다 그냥 보이는 쪽이 낫다).
 */
import { useEffect } from "react";
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

/** 점검 중이면 점검 화면으로. 화면을 옮길 때마다 다시 본다(읽어 둔 값으로). */
export function useMaintenanceRedirect(): void {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (isAdminRoute(pathname) || pathname === ROUTES.maintenance) return;
    let isActive = true;
    readMaintenance().then((state) => {
      if (isActive && state.on) navigate(ROUTES.maintenance, { replace: true, state: { message: state.message } });
    });
    return () => {
      isActive = false;
    };
  }, [pathname, navigate]);
}

/** 시험 · 미리보기용 — 읽어 둔 값을 버린다 */
export function resetMaintenanceCache(): void {
  cached = null;
  pending = null;
}
