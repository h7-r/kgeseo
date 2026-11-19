// 본편 실제 부팅 — main.tsx 가 기기 판정(PC 만)을 통과했을 때만 동적으로 불러온다(나주입장 02회차). 아래는 예전 main.tsx 그대로.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import App from "@/app/App";
import CharacterCreationRoute, { CHARACTER_CREATION_PATH } from "@/characterCreation/CharacterCreationRoute";
import { LandscapeGuard } from "@/engine/input";
import { LoadingVideoOverlay } from "@/naju";
import { initGameSave } from "@/save/gameSave";
import { registerMainGameSave } from "@/save/mainGameSave";
import { decideResume, finishResume } from "@/save/resumeStart";
import SaveLoadFailedNotice from "@/save/SaveLoadFailedNotice";

// 효과음은 앱 시작에 미리 받아 두고 첫 입력에 오디오를 깨운다.
import "@/audio/sound";
import "./index.css";
// 손글씨 폰트(@font-face) — 화이트보드에서 쓴다
import "./fonts.css";
import { BetaPreSurvey } from "./beta/BetaSurveyCard";

const root = document.getElementById("root");
if (!root) throw new Error("#root 가 없습니다");

// 주소가 바뀌어도 씬은 한 페이지 안에서 바뀐다(새로고침 없음).
// 웹사이트 「게임 시작」 → 캐릭터 생성 → 튜토리얼(/). 생성 중에는 게임 씬을 띄우지 않는다.
// 로딩 영상 막은 라우터 안·Routes 밖에 한 번만 — 주소가 바뀌어도 살아 있게.
// 저장본을 먼저 받아 넣은 뒤 그린다. 그려진 뒤에 넣으면 처음 자리가 한 번 보였다가 튄다.
// 다시 접속이면 어디서 시작할지(튜토리얼 처음부터 · 로비) · 오프닝을 다시 틀지를 그리기 전에 정한다(save/resumeStart)
void initGameSave().finally(() => {
  decideResume();
  registerMainGameSave();
  finishResume();
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path={CHARACTER_CREATION_PATH} element={<CharacterCreationRoute />} />
          <Route path="*" element={<App />} />
        </Routes>
        <LoadingVideoOverlay />
        {/* 베타 — 참여 코드가 있으면 시작 전 설문을 한 번 묻는다(폼 주소가 없으면 그리지 않는다) */}
        <BetaPreSurvey />
        {/* 저장 불러오기가 실패했을 때만 — 「저장을 불러오지 못했어요. 지금 새로고침해 주세요」(저장은 멈춘 그대로) */}
        <SaveLoadFailedNotice />
        {/* 휴대폰 세로면 무엇보다 위에서 「가로로 돌려 주세요」 — 첫 로딩 · 오프닝 · 캐릭터 생성 · 게임 씬 모두 */}
        <LandscapeGuard />
      </BrowserRouter>
    </StrictMode>,
  );
});
