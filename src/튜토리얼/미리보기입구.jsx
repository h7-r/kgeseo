// 튜토리얼 안내 미리보기 전용 진입점. 본편(index.html)과 섞이지 않는다.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TG미리보기 from "./미리보기.jsx";
import "../index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <TG미리보기 />
  </StrictMode>,
);
