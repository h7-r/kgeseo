// 나주 엔트리 — 지금은 PC(키보드 · 마우스)에서만 연다(미르 11/11). 휴대폰 · 태블릿으로 /naju01/ 을 바로 열어도 게임 모듈 · 에셋을
// 받기 전에 안내만 그린다. 판정 · 문구는 shared/playDevicePolicy. 통과하면 boot.tsx(예전 main.tsx)를 불러온다.
import { isPlayDeviceBlocked, renderPcOnlyNotice } from "../../shared/playDevicePolicy";
import { SITE_URL } from "@/lib/siteUrl";

const container = document.getElementById("root");
if (!container) throw new Error("#root 가 없다");

if (isPlayDeviceBlocked({ allowOverride: import.meta.env.DEV || import.meta.env.VITE_ALLOW_DEVICE_OVERRIDE === "1" })) {
  renderPcOnlyNotice(container, SITE_URL);
} else {
  void import("./boot");
}
