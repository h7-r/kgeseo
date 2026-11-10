import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { startBackgroundLoading } from "@/app/boot";
import { isAdminRoute } from "@/navigation/routes";
import { restoreServerSession } from "@/services/session";

import App from "./App";

import "@/styles/index.css";
import "@/mobile/mobile.css";

startBackgroundLoading();
// 관리자 화면은 들어올 때 권한 검사(RequireAdmin)가 /me 를 다시 묻는다. 여기서도 부르면 같은 요청이 두 번 나간다.
if (!isAdminRoute(window.location.pathname)) void restoreServerSession();

// 새로고침 때 이전 스크롤 위치로 복원되면 긴 페이지가 중간에서 시작한다.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
window.scrollTo(0, 0);

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
