// main.jsx — Vite 리액트 앱의 '시작점'(엔트리)
// 개념: 브라우저의 <div id="root">에 우리 리액트 앱(App)을 그려 넣는 파일.

import React from "react"; // 리액트 코어
import ReactDOM from "react-dom/client"; // 리액트를 실제 DOM에 붙여주는 도구
import App from "./App.jsx"; // 우리 앱의 최상위 컴포넌트
// 라우터 — 주소(/ , /train)에 따라 어떤 씬을 그릴지 정한다.
//   씬을 파일로 나눠도 '한 페이지 안에서' 바뀌므로 새로고침이 없다 = 즉시 전환.
import { BrowserRouter } from "react-router-dom";
import "./index.css"; // 전역 스타일(16:9 무대 등)
import "./fonts.css";
import "./소리.js"; // 효과음 시스템을 앱 시작에 미리 켠다(첫 클릭에 오디오 깨움 + 사운드 미리 로드) // 손글씨 폰트 등록(@font-face "엉겅퀴") — 화이트보드에서 쓴다

// createRoot: index.html 의 #root 자리를 리액트가 관리하도록 '뿌리'를 만든다
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {" "}
    {/* 개발 중 실수(부작용 등)를 잡아주는 검사 모드 */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
