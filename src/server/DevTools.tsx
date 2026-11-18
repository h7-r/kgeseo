/**
 * (?dev · 개발 서버만) 개발 도구 묶음 — Backend·DB 준비 상태, 소화전 자물쇠 플레이 세션 상태.
 * App 이 import.meta.env.DEV 안에서만 lazy 로 받아 운영 번들에는 들지 않는다(인증 점검 M13).
 * 옛 Google 로그인 PoC(GoogleSignIn)는 지웠다 — 지금 /auth/google 응답 모양과도 안 맞는 죽은 코드였고, 운영에서 세션 쿠키를 바꿀 수 있었다.
 */
import BackendStatus from "./BackendStatus";
import PlaySessionStatusPanel from "./PlaySessionStatusPanel";

export default function DevTools() {
  return (
    <>
      <BackendStatus />
      <PlaySessionStatusPanel />
    </>
  );
}
