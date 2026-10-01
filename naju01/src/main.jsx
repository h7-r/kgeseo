// main.jsx — NAJU-01 그레이박스의 시작점
//   본편(../../src/main.jsx)과 같은 구조다. 씬이 하나뿐이라 라우터만 뺐다.
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
// 본편 기차에서 텔레포트로 넘어오면, 본편이 틀던 로딩 영상을 **같은 장면부터** 이어 틀고
//   이 맵이 다 뜨면 걷는다(전환/로딩영상.jsx — sessionStorage 로 이어받는다).
import 로딩영상판 from "./전환/로딩영상.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <로딩영상판 />
  </React.StrictMode>,
);
