import { lazy, Suspense } from "react";

// ?dev 일 때만 그리므로 평소엔 받지도 않는다.
const BackendStatus = lazy(() => import("@/server/BackendStatus"));
const GoogleSignIn = lazy(() => import("@/server/GoogleSignIn"));
const PlaySessionStatusPanel = lazy(() => import("@/server/PlaySessionStatusPanel"));

/** 임시 개발 도구 — Backend·DB 준비 상태, 시연용 Google 로그인, 플레이 세션 상태 */
export default function DevTools() {
  return (
    <Suspense fallback={null}>
      <BackendStatus />
      <GoogleSignIn />
      <PlaySessionStatusPanel />
    </Suspense>
  );
}
