import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { startBackgroundLoading } from "@/app/boot";

import App from "./App";

import "@/styles/index.css";

startBackgroundLoading();

// 새로고침 때 이전 스크롤 위치로 복원되면 긴 페이지가 중간에서 시작한다.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
window.scrollTo(0, 0);

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

// 개발 서버에서만 여는 3D 장면 시험 화면. 조건이 빌드 때 false 로 굳어 배포본엔 이 import 가 없다.
if (import.meta.env.DEV && window.location.pathname === "/__river") {
  void import("@/three/river/RiverLab").then(({ default: RiverLab }) => {
    createRoot(root).render(<RiverLab />);
  });
} else {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
