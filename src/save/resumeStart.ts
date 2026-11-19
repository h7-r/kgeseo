/**
 * 다시 접속했을 때의 시작을 첫 화면을 그리기 전에 한 번 정한다(main.tsx — 저장을 받은 뒤). 규칙은 resumePolicy.
 *
 *   튜토리얼 처음부터(처음 · 튜토리얼 중 나갔음): 튜토리얼 저장 칸(위치 · 단계 · 소지품)을 넣지 않고, 서버 퍼즐 회차도 새로 연다.
 *     힌트함 · 현장 퍼즐 · 연출은 저장되지 않아 새 페이지면 처음 상태다. 외형은 따로 저장돼 남는다
 *   튜토리얼 뒤(본부실에 들어선 뒤): 본부실에 들어선 것으로 적고 비밀 복도 문을 잠근다. 로비 자리는 App(#76)
 * 본부실에 처음 들어서는 순간에는 튜토리얼 쪽지를 지우고 본부실 단계를 바로 저장한다.
 */
import { TRAIN_PATH } from "@/app/useSceneTransition";
import { najuCaseProgress, replaceOpeningWithResume } from "@/naju";
import { markEnteredHeadquarters, onEnteredHeadquarters, sealHeadquartersDoor } from "@/props/vendingPushState";
import { forgetPlaySession } from "@/server/playSession";
import { discardTutorialHints } from "@/tutorial/tutorialHints";
import { TUTORIAL_STEPS, restoreTutorial, tutorialStore } from "@/tutorial/tutorialState";

import { getSavedStage, readSavedSection, removeSavedSections, saveBeforeLeaving, setGameStage } from "./gameSave";
import { LOBBY_ENTRY_PARAM, LOBBY_ENTRY_VALUE, isLobbyStage } from "./lobbyEntry";
import { STATION_POSE_SECTION, TRAIN_POSE_SECTION } from "./mainGameSave";
import { TUTORIAL_SECTIONS, resumeKindFor, skipsOpening, type ResumeKind } from "./resumePolicy";

/** 다시 접속해 튜토리얼을 처음부터 다시 할 때 띄우는 안내 */
export const TUTORIAL_RESTART_MESSAGE = "튜토리얼을 처음부터 다시 시작합니다";

let resumeKind: ResumeKind = "new";
let isRestartNoticePending = false;

/** 이번 접속의 시작(처음 · 튜토리얼 처음부터 다시 · 튜토리얼 뒤) */
export const getResumeKind = () => resumeKind;

/** 안내를 아직 안 띄웠으면 true 를 한 번만 돌려준다 */
export function takeRestartNotice(): boolean {
  if (!isRestartNoticePending) return false;
  isRestartNoticePending = false;
  return true;
}

/** 저장을 받은 뒤 · 저장 칸을 등록하기 전에 부른다(등록할 때 저장값이 들어가므로) */
export function decideResume(): void {
  const stage = getSavedStage();
  resumeKind = resumeKindFor({
    stage,
    stationPose: readSavedSection(STATION_POSE_SECTION),
    hasTrainPose: readSavedSection(TRAIN_POSE_SECTION) != null,
    hasNajuProgress: najuCaseProgress((name) => readSavedSection(name)) !== null,
  });
  // 웹사이트에서 넘어왔어도(?transition=) 캐릭터를 만든 뒤면 오프닝 대신 짧은 영상
  if (skipsOpening(stage)) replaceOpeningWithResume();
  normalizeEntryPath();

  if (resumeKind === "afterTutorial") {
    markEnteredHeadquarters();
    sealHeadquartersDoor();
    // 예전 판에서 본부실 뒤인데 단계가 튜토리얼로 내려가 적힌 저장을 바로잡는다
    if (!isLobbyStage(stage)) setGameStage("headquarters");
    return;
  }
  // 처음 · 튜토리얼 처음부터 — 지난 위치 · 단계 · 소지품을 넣지 않고, 서버 퍼즐 회차도 이어 쓰지 않는다(손님도 같은 브라우저면 회차가 남아 있다)
  // 칸을 등록하기 전이라 다 지워진다(등록된 칸은 다음 저장 때 새 값으로 다시 적힌다)
  removeSavedSections((name) => TUTORIAL_SECTIONS.includes(name));
  forgetPlaySession();
  isRestartNoticePending = resumeKind === "restartTutorial";
}

/** 저장 칸을 등록한 뒤에 부른다 */
export function finishResume(): void {
  // 튜토리얼 칸이 없거나 덜 끝난 옛 저장이어도 본부실 뒤면 튜토리얼은 끝난 것이다(본부실에서 튜토리얼이 처음부터 뜨지 않게)
  if (resumeKind === "afterTutorial" && !tutorialStore.get().isFinished)
    restoreTutorial({ step: TUTORIAL_STEPS.length - 1, isFinished: true });
  // 본부실에 처음 들어서는 순간 — 튜토리얼 쪽지를 지우고, 본부실 단계를 기다리지 않고 바로 적는다
  // (2초마다 살피고 1.5초 모아 쓰면 그사이 나간 사람은 다음 접속에 튜토리얼 처음으로 돌아간다)
  // 오가던 저장이 있으면 그것이 끝난 뒤 최신 값(본부실 단계)을 다시 쓴다(saveBeforeLeaving — 늦어도 기다리지 않고 계속 간다)
  onEnteredHeadquarters(() => {
    discardTutorialHints();
    setGameStage("headquarters");
    void saveBeforeLeaving();
  });
}

/**
 * 새 문서가 기차 주소(/train)로 열렸으면(새로 고침 · 주소 직접) 시작 자리로 옮긴다 — 본부실 전이면 튜토리얼 처음(/), 뒤면 로비.
 * 기차는 본부실에서 타는 것이다 — 그대로 두면 튜토리얼 중인 사람이 기차에서 시작해 단계가 train 으로 적혔다(Codex 리뷰).
 * 같은 문서 안에서 기차에 타는 이동은 이 함수와 상관없다. 라우터가 주소를 읽기 전(첫 그리기 전)에 부른다
 */
function normalizeEntryPath(): void {
  const url = new URL(window.location.href);
  if (url.pathname !== TRAIN_PATH) return;
  url.pathname = "/";
  if (resumeKind === "afterTutorial") url.searchParams.set(LOBBY_ENTRY_PARAM, LOBBY_ENTRY_VALUE);
  else url.searchParams.delete(LOBBY_ENTRY_PARAM);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
