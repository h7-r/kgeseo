// NAJU-01 그레이박스의 시작점. 본편 main 과 같은 구조에서 라우터만 뺐다.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app/App";
// 본편 기차에서 텔레포트로 넘어오면 본편이 틀던 로딩 영상을 같은 장면부터 이어 틀고, 이 맵이 다 뜨면 걷는다
import LoadingVideoOverlay from "./transition/LoadingVideoOverlay";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root 가 없다");

createRoot(container).render(
  <StrictMode>
    <App />
    <LoadingVideoOverlay />
  </StrictMode>,
);
