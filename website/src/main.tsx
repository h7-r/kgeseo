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

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
