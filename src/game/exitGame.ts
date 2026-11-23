/**
 * 「게임 종료」 — 멈춤 메뉴에서 저장하고 웹사이트 첫 화면으로 간다(미르 11/11, 나주입장 08회차).
 * 브라우저 탭은 스크립트로 닫을 수 없어 홈으로 보낸다. 저장이 실제로 끝났는지(saveBeforeLeaving) 확인한 뒤에 간다 —
 * flushGameSave 는 성공 여부를 주지 않는다(Codex). 못 했으면 붙잡지 않고 부른 쪽이 「저장하지 않고 종료」를 내민다.
 * 로그인하지 않았으면 저장할 것이 없어 바로 간다(메뉴가 미리 알린다). 세션이 끊긴 채면(signed_out) 바로 가지 않는다 —
 * 끊긴 뒤의 진행이 서버에 없으니 저장 실패로 돌려 메뉴가 까닭을 알리고 한 번 더 묻게 한다(인증 점검 M14).
 */
import { betaLog } from "@/beta/betaLog";
import { SITE_URL } from "@/lib/siteUrl";
import { getSaveStatus, saveBeforeLeaving } from "@/save/gameSave";
import type { SaveStatus } from "@/save/saveStatus";
import { saveFailureText, unsavedNote } from "@/save/saveStatusText";

export type ExitResult = "left" | "saveFailed";

let isExiting = false;
// 브라우저 「뒤로」로 이 페이지가 캐시에서 되살아나면 다시 끝낼 수 있게
if (typeof window !== "undefined")
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) isExiting = false;
  });

/** 끝내기 전에 저장을 확인해야 하나 — 저장 중이거나, 저장 중이었다가 끊겼으면(그 뒤 진행이 서버에 없다) */
const needsSaveBeforeExit = (status: SaveStatus) =>
  status === "saving" || status === "signed_out" || status === "account_changed" || status === "conflict";

/** 저장하고 홈으로. force 면 저장하지 못해도 간다 */
export async function exitGame(force = false): Promise<ExitResult> {
  if (isExiting) return "left";
  if (!force && needsSaveBeforeExit(getSaveStatus()) && !(await saveBeforeLeaving())) return "saveFailed";
  isExiting = true;
  // 베타 기록 — 「게임 종료」로 떠났다(나주면 그 회차에 붙는다). 남은 기록은 페이지를 떠날 때 keepalive 로 보낸다
  betaLog.track("run_state", "quit", { data: { forced: force } });
  window.location.assign(SITE_URL);
  return "left";
}

/**
 * 끝내기 전 한 줄 — 무엇이 남는지. 튜토리얼은 다시 들어오면 처음부터다(이어 준다고 약속하지 않는다, 08회차 Codex).
 * 저장이 안 되면 그 까닭(로그인 안 함 · 세션 끊김 · 불러오기 실패)을 가른다
 */
export function exitNote(place: "tutorial" | "lobby" | "case"): string {
  if (place === "tutorial") return "튜토리얼은 다시 들어오면 처음부터 시작해요.";
  const unsaved = unsavedNote(getSaveStatus());
  if (unsaved) return unsaved;
  if (place === "case")
    return "지금까지 한 조사는 저장돼요. 다시 들어오면 로비에서 시작하고, 기차에서 이어 할 수 있어요.";
  return "지금까지 한 것은 저장돼요. 다시 들어오면 로비에서 시작해요.";
}

const EXIT_FAILED_TEXT = "저장하지 못했어요. 연결을 확인하고 다시 해 보거나, 저장하지 않고 끝낼 수 있어요.";

/** 저장 못 하고 끝내기 실패했을 때 메뉴에 남길 글 — 세션이 끊긴 것이면 연결 탓이 아니라 그 까닭을 */
export const exitFailureText = () => saveFailureText(getSaveStatus(), EXIT_FAILED_TEXT);
