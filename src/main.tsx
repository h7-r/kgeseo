import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import App from "@/app/App";
import CharacterCreationRoute, { CHARACTER_CREATION_PATH } from "@/characterCreation/CharacterCreationRoute";
import { LoadingVideoOverlay } from "@/naju";

// 효과음은 앱 시작에 미리 받아 두고 첫 입력에 오디오를 깨운다.
import "@/audio/sound";
import "./index.css";
// 손글씨 폰트(@font-face) — 화이트보드에서 쓴다
import "./fonts.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다");

// 주소가 바뀌어도 씬은 한 페이지 안에서 바뀐다(새로고침 없음).
// 웹사이트 「게임 시작」 → 캐릭터 생성 → 튜토리얼(/). 생성 중에는 게임 씬을 띄우지 않는다.
// 로딩 영상 막은 라우터 안·Routes 밖에 한 번만 — 주소가 바뀌어도 살아 있게.
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path={CHARACTER_CREATION_PATH} element={<CharacterCreationRoute />} />
        <Route path="*" element={<App />} />
      </Routes>
      <LoadingVideoOverlay />
    </BrowserRouter>
  </StrictMode>,
);
