import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./토큰.css";
import "./index.css";
import 앱 from "./앱.jsx";

/* 새로고침 시 브라우저가 이전 스크롤 위치를 복원 → 페이지가 중간에서 시작되던 문제.
   수동으로 바꿔 항상 맨 위(헤더 최상단)에서 깔끔하게 시작한다. */
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
window.scrollTo(0, 0);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <앱 />
    </BrowserRouter>
  </StrictMode>,
);
