/**
 * 나주에서 로비(합동수사본부)로 나간다 — 설정 창 · 터치 멈춤 화면 · PC 멈춤 메뉴의 「로비로 나가기」(미르 11/10).
 * PC 멈춤 메뉴의 「다른 지역으로(기차)」도 같은 길로 가되 `/?entry=train` — 본편이 로비 대신 기차 안에서 목적지 창을 열어 둔다(미르 11/11).
 * 단계를 본부실로 적고, 저장이 실제로 끝난 것을 확인한 뒤(saveBeforeLeaving) 로딩 영상으로 덮고 `/?entry=lobby` 로 페이지째 간다.
 * 나주 칸(퍼즐 진행)은 그대로 남아 기차 목적지 창에서 다시 들어가면 이어진다. 저장하지 못하면 붙잡지 않고 부른 쪽이 「그래도 나가기」를 내민다.
 */
import type { LeaveResult, LeaveToLobbyAction } from "@/game/LeaveToLobby";
import { isGameSaveEnabled, saveBeforeLeaving, setGameStage } from "@/save/gameSave";
import { LOBBY_PATH, TRAIN_ENTRY_PATH, markLobbyReturn } from "@/save/lobbyEntry";

import { continueLoadingVideoAt, showLoadingVideo } from "../transition/loadingVideo";

/** 영상이 화면을 덮은(0.7초 페이드) 뒤 넘어간다 — 기차 → 나주(NajuEntryTransition)와 같은 박자 */
const COVER_THEN_LEAVE_MS = 700;

let isLeaving = false;
/**
 * 저장이 필요한가(나주에 들어올 때 로그인했나) — 단추를 만들 때 정한다. 그 뒤 자동 저장 · 나가는 저장에서 로그인이 풀려도(401)
 * 끝까지 지킨다. 저장 없이 나가는 것은 「그래도 나가기」(force)로만(Codex 리뷰)
 */
let isSaveRequired = false;
// 브라우저 「뒤로」로 이 페이지가 캐시에서 되살아나면 다시 나갈 수 있게(Codex 리뷰)
if (typeof window !== "undefined")
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) isLeaving = false;
  });

async function leaveTo(path: string, force = false): Promise<LeaveResult> {
  if (isLeaving) return "left";
  setGameStage("headquarters");
  if (isSaveRequired && !force) {
    const isSaved = isGameSaveEnabled() && (await saveBeforeLeaving());
    if (!isSaved) {
      // 남는다 — 단계를 되돌린다(나가지 않았는데 다음 저장이 본부실로 적지 않게)
      setGameStage("naju");
      return "saveFailed";
    }
  }
  isLeaving = true;
  // 로그인하지 않았으면 저장 단계가 없다 — 이 탭에 잠깐 표시를 남겨 로비가 받게 한다
  markLobbyReturn();
  showLoadingVideo("tutorial", { keepOpen: true });
  // 페이지 이동은 실제 시각 — 터치에서 창 · 멈춤 때문에 게임 시계가 얼어 있다
  window.setTimeout(
    () => continueLoadingVideoAt(new URL(path, window.location.origin).toString()),
    COVER_THEN_LEAVE_MS,
  );
  return "left";
}

const leave = (force = false) => leaveTo(LOBBY_PATH, force);
/** 기차로(다른 지역 고르기) — 저장 · 실패 처리는 로비로 나가기와 같다 */
export const leaveToTrain = (force = false) => leaveTo(TRAIN_ENTRY_PATH, force);

/**
 * 로비로 나갈 곳이 있나 — 본편과 한 출처에서 /naju01/ 로 돌 때만(운영 · 본편 개발 서버). 나주만 따로 띄운 개발 서버(npx vite naju01)는
 * `/` 가 다시 나주라 단추를 두지 않는다(Codex 리뷰)
 */
export const canLeaveToLobby = () => typeof window !== "undefined" && window.location.pathname.startsWith("/naju01");

export function leaveToLobbyAction(): LeaveToLobbyAction {
  isSaveRequired = isGameSaveEnabled();
  return {
    note: isSaveRequired
      ? "지금까지 한 것은 저장돼요. 로비의 기차 목적지 창에서 이어서 할 수 있어요."
      : "로그인하지 않아 지금까지 한 것은 저장되지 않아요.",
    leave,
  };
}
