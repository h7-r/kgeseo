/**
 * 저장 상태별 안내 문구 — 멈춤 메뉴(본편 · 나주) · 로비로 나가기 · 끊김 안내가 같이 쓴다. 상태는 부르는 쪽이 getSaveStatus() 로 넘긴다.
 * 「로그인 안 함」 「세션 끊김」 「계정 바뀜」 「다른 창 저장」 「불러오기 실패」를 가른다 — 전에는 전부 「로그인하지 않아…」였다(인증 점검 M14).
 * React · 별칭(@/) 을 쓰지 않는다(naju01/tests 의 node --test 가 바로 읽는다).
 */
import type { SaveStatus } from "./saveStatus";

/** 저장이 안 되는 까닭 한 줄 — 저장 중이면 null. 나가기 · 끝내기 물음 밑에 붙는다 */
export function unsavedNote(status: SaveStatus): string | null {
  switch (status) {
    case "saving":
      return null;
    case "guest":
      return "로그인하지 않아 지금까지 한 것은 저장되지 않아요.";
    case "load_failed":
      return "저장을 불러오지 못해 이 판은 저장되지 않아요. 새로고침하면 다시 불러와요.";
    case "signed_out":
      return "로그인이 풀려 저장이 멈췄어요. 다시 로그인하면 이어서 저장돼요. 지금 나가면 풀린 뒤에 한 것은 남지 않아요.";
    case "account_changed":
      return "다른 계정으로 로그인되어 저장을 멈췄어요. 지금 나가면 멈춘 뒤에 한 것은 남지 않아요.";
    case "conflict":
      return "다른 창에서 진행이 저장되어 이 창의 저장을 멈췄어요. 새로고침하면 최신 진행으로 이어져요. 지금 나가면 멈춘 뒤에 한 것은 남지 않아요.";
  }
}

/**
 * 저장하지 못했을 때 — 세션이 끊겼으면 그 까닭을, 아니면 부른 쪽의 연결 실패 문구(connectionText)를.
 * 끊긴 쪽 문구는 「다시 해 보기」를 전제한다 — 다시 로그인한 뒤 누르면 saveBeforeLeaving 이 로그인을 다시 확인하고 저장한다
 */
export function saveFailureText(status: SaveStatus, connectionText: string): string {
  if (status === "signed_out")
    return "로그인이 풀려 저장하지 못했어요. 다른 탭에서 다시 로그인한 뒤 「다시 해 보기」를 누르면 저장돼요.";
  if (status === "account_changed")
    return "다른 계정으로 로그인되어 저장하지 못했어요. 이 창의 진행은 그 계정에 저장하지 않아요.";
  if (status === "conflict")
    return "다른 창에서 진행이 저장되어 저장하지 못했어요. 새로고침하면 최신 진행으로 이어져요.";
  return connectionText;
}

/** 「처음부터 다시」를 막는 까닭 — 세션이 끊긴 채로는 서버 기록을 지울 수 없다. 저장 중 · 손님이면 null(막지 않는다) */
export function restartBlockedReason(status: SaveStatus): string | null {
  if (status === "signed_out") return "로그인이 풀려 지금은 기록을 지울 수 없어요. 다시 로그인한 뒤 해 주세요.";
  if (status === "account_changed") return "다른 계정으로 로그인되어 있어요. 새로고침한 뒤 해 주세요.";
  if (status === "conflict") return "다른 창에서 진행이 저장됐어요. 새로고침한 뒤 해 주세요.";
  return null;
}

/** 화면 위쪽 끊김 안내 — 세션이 끊겼을 때 · 계정이 바뀌었을 때 · 다른 창이 먼저 저장했을 때 */
export const SESSION_LOST_TEXT = {
  signed_out: {
    title: "로그인이 풀렸어요",
    body: "다시 로그인하면 이어서 저장돼요. 지금까지 한 것은 이 창에만 남아 있으니 창을 닫지 마세요.",
    openLogin: "로그인 창 열기",
    recheck: "로그인했어요",
    stillOut: "아직 로그인되지 않았어요. 로그인 창에서 로그인한 뒤 다시 눌러 주세요.",
  },
  account_changed: {
    title: "다른 계정으로 로그인되어 저장을 멈췄어요",
    body: "이 창의 진행은 저장되지 않아요. 새로고침하면 그 계정의 저장으로 시작해요.",
    reload: "새로고침",
  },
  conflict: {
    title: "다른 창에서 진행이 저장됐어요",
    body: "이 창의 저장을 멈췄어요. 새로고침하면 최신 진행으로 이어집니다.",
    reload: "새로고침",
  },
  close: "닫기",
} as const;
