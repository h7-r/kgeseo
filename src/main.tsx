// 본편 엔트리 — 지금은 PC(키보드 · 마우스)에서만 연다(미르 11/11). 휴대폰 · 태블릿이면 게임 모듈 · 에셋을 받기 전에 안내만 그린다.
// 판정 · 문구는 shared/playDevicePolicy(웹사이트 · 나주와 같다). 통과하면 boot.tsx(예전 main.tsx)를 불러온다.
import { isPlayDeviceBlocked, renderPcOnlyNotice } from "../shared/playDevicePolicy";
import { SITE_URL } from "./lib/siteUrl";

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다");

// 우회(?device=any)는 개발 서버 · 검수 빌드(VITE_ALLOW_DEVICE_OVERRIDE=1)에서만
if (isPlayDeviceBlocked({ allowOverride: import.meta.env.DEV || import.meta.env.VITE_ALLOW_DEVICE_OVERRIDE === "1" })) {
  renderPcOnlyNotice(root, SITE_URL);
} else {
  void import("./boot");
}
