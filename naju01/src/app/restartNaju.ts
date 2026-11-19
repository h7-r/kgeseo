/**
 * 나주를 처음부터 다시 — 이 페이지에서 나주 칸을 지우고(restartNajuHere) 같은 나주 주소를 새로 연다. 기차에서 들어올 때처럼 영상으로 덮고
 * 이어 튼다(from=hub). 멈춤 메뉴 · 클리어 화면이 같이 쓴다(나주엔딩).
 */
import { noteNajuRestart } from "../beta/najuBeta";
import { restartNajuHere } from "../progress/resetCase";
import { continueLoadingVideoAt, showLoadingVideo } from "../transition/loadingVideo";

/** 새 판이 같은 장면부터 잇게 덮은 뒤(0.7초 페이드) 넘어간다 — 로비로 나가기와 같은 박자 */
const COVER_THEN_LEAVE_MS = 700;
export const RESTART_FAILED_TEXT = "기록을 지우지 못했어요. 연결을 확인하고 다시 해 보세요.";

/** 지우고 새로 연다. 지우지 못하면 false(그대로 남는다) */
export async function restartNajuCase(): Promise<boolean> {
  if (!(await restartNajuHere())) return false;
  // 베타 기록 — 다음에 나주가 열리면 새 회차
  noteNajuRestart("naju");
  // 미리 보기 질의(card)는 뗀다
  const url = new URL(window.location.href);
  url.searchParams.delete("card");
  url.searchParams.set("from", "hub");
  showLoadingVideo("naju", { keepOpen: true });
  window.setTimeout(() => continueLoadingVideoAt(url.toString()), COVER_THEN_LEAVE_MS);
  return true;
}
