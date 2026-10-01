// main.jsx — Vite 리액트 앱의 '시작점'(엔트리)
// 개념: 브라우저의 <div id="root">에 우리 리액트 앱(App)을 그려 넣는 파일.

import React from "react"; // 리액트 코어
import ReactDOM from "react-dom/client"; // 리액트를 실제 DOM에 붙여주는 도구
import App from "./App.jsx"; // 우리 앱의 최상위 컴포넌트
// 라우터 — 주소(/ , /train)에 따라 어떤 씬을 그릴지 정한다.
//   씬을 파일로 나눠도 '한 페이지 안에서' 바뀌므로 새로고침이 없다 = 즉시 전환.
import { BrowserRouter, Routes, Route } from "react-router-dom";
// 웹사이트 「게임 시작」 → 캐릭터 생성 → 튜토리얼(/). 생성 중에는 게임 씬(App)을 안 띄운다.
import 캐릭터생성연결 from "./캐릭터생성연결.jsx";
// 화면이 넘어가는 사이(렌더링)를 반복 영상으로 가리는 막 — 라우터 **바깥**에 한 번(주소가 바뀌어도 살아 있게).
//   나주 맵(naju01)도 같은 막을 쓰므로 naju01 쪽에 있다(naju01/src/전환/로딩영상.jsx 머리 주석).
import 로딩영상판 from "../naju01/src/전환/로딩영상.jsx";
import "./index.css"; // 전역 스타일(16:9 무대 등)
import "./fonts.css";
import "./소리.js"; // 효과음 시스템을 앱 시작에 미리 켠다(첫 클릭에 오디오 깨움 + 사운드 미리 로드) // 손글씨 폰트 등록(@font-face "엉겅퀴") — 화이트보드에서 쓴다

// createRoot: index.html 의 #root 자리를 리액트가 관리하도록 '뿌리'를 만든다
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {" "}
    {/* 개발 중 실수(부작용 등)를 잡아주는 검사 모드 */}
    <BrowserRouter>
      <Routes>
        <Route path="/캐릭터생성" element={<캐릭터생성연결 />} />
        <Route path="*" element={<App />} />
      </Routes>
      <로딩영상판 />
    </BrowserRouter>
  </React.StrictMode>,
);
