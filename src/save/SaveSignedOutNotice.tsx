/**
 * 「로그인이 풀렸어요」 — 게임 중 세션이 끊겨(401) 저장이 멈췄을 때 화면 위쪽 가운데에 뜬다(본편 · 나주 같은 것, 인증 점검 M14).
 * 전에는 조용히 멈춰 플레이어가 진행이 안 남는 줄 모르고 하다가 잃었다.
 *   signed_out       로그인 창(웹사이트)을 새 탭으로 열어 준다 — 이 창을 떠나면 끊긴 뒤의 진행이 사라지니 여기서는 이동하지 않는다.
 *                    「로그인했어요」가 /me 로 다시 확인하고 같은 계정이면 저장을 다시 켠다(resumeSavingAfterLogin).
 *   account_changed  다른 계정의 세션이 됐다 — 저장은 멈춘 채 새로고침만 권한다(그 계정의 저장을 이 창 값으로 덮지 않게).
 * 닫을 수 있다. 닫아도 상태는 그대로라 멈춤 메뉴가 같은 까닭을 보인다. 누름이 게임(포인터 잠금 · 클릭 조작)으로 새지 않게 막는다.
 * 멈춤 메뉴와 같은 색(gameUi) — 저장 불러오기 실패 안내(SaveLoadFailedNotice)와는 같은 자리, 둘이 함께 뜨는 일은 없다.
 */
import { useState, useSyncExternalStore, type CSSProperties } from "react";

import { NAVY_FILL, PANEL_SHADOW, UI, UI_FONT } from "@/game/gameUi";
import { SITE_URL } from "@/lib/siteUrl";

import { getSaveStatus, resumeSavingAfterLogin, subscribeSaveStatus } from "./gameSave";
import type { SaveStatus } from "./saveStatus";
import { SESSION_LOST_TEXT } from "./saveStatusText";

type LostStatus = "signed_out" | "account_changed";

const isLost = (status: SaveStatus): status is LostStatus => status === "signed_out" || status === "account_changed";

/** 웹사이트 로그인 화면 — next 를 붙이지 않는다(붙이면 로그인 뒤 그 탭에 게임이 또 열려 이 창과 저장이 겹친다) */
const loginUrl = () => new URL("/login", SITE_URL).href;

function stop(event: { stopPropagation(): void }) {
  event.stopPropagation();
}

export default function SaveSignedOutNotice() {
  const status = useSyncExternalStore(subscribeSaveStatus, getSaveStatus, getSaveStatus);
  // 닫은 상태를 기억한다 — 상태가 또 바뀌면(끊김 → 계정 바뀜) 다시 뜬다
  const [dismissedFor, setDismissedFor] = useState<LostStatus | null>(null);
  const [isStillOut, setIsStillOut] = useState(false);
  if (!isLost(status) || dismissedFor === status) return null;

  const recheck = async () => {
    setIsStillOut(false);
    const next = await resumeSavingAfterLogin();
    if (next === "signed_out") setIsStillOut(true);
  };

  return (
    <div
      role="alert"
      style={bar}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onKeyDown={stop}
      onTouchStart={stop}
    >
      <div style={message}>
        <div style={title}>{SESSION_LOST_TEXT[status].title}</div>
        <div style={body}>{SESSION_LOST_TEXT[status].body}</div>
        {status === "signed_out" && isStillOut && <div style={warning}>{SESSION_LOST_TEXT.signed_out.stillOut}</div>}
      </div>
      <div style={buttons}>
        {status === "signed_out" ? (
          <>
            <button type="button" style={secondary} onClick={() => window.open(loginUrl(), "_blank", "noopener")}>
              {SESSION_LOST_TEXT.signed_out.openLogin}
            </button>
            <button type="button" style={primary} onClick={() => void recheck()}>
              {SESSION_LOST_TEXT.signed_out.recheck}
            </button>
          </>
        ) : (
          <button type="button" style={primary} onClick={() => window.location.reload()}>
            {SESSION_LOST_TEXT.account_changed.reload}
          </button>
        )}
        <button type="button" style={quiet} onClick={() => setDismissedFor(status)}>
          {SESSION_LOST_TEXT.close}
        </button>
      </div>
    </div>
  );
}

const bar: CSSProperties = {
  position: "fixed",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  // 로딩 영상(100000) · 베타 설문 막(2147483000)보다 위 — 어느 장면에서 끊겨도 보이게
  zIndex: 2147483001,
  width: "min(600px, calc(100vw - 32px))",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "14px 16px",
  borderRadius: 14,
  background: UI.glass,
  border: `1px solid ${UI.borderStrong}`,
  color: UI.text,
  boxShadow: PANEL_SHADOW,
  fontFamily: UI_FONT.body,
  lineHeight: 1.45,
};
const message: CSSProperties = { flex: "1 1 260px", minWidth: 0 };
const title: CSSProperties = { fontSize: 16, fontWeight: 700 };
const body: CSSProperties = { fontSize: 13, color: UI.textMuted, marginTop: 2 };
const warning: CSSProperties = { fontSize: 13, color: UI.danger, marginTop: 6 };
const buttons: CSSProperties = { display: "flex", gap: 8, flex: "0 0 auto", marginLeft: "auto", flexWrap: "wrap" };
const buttonBase: CSSProperties = {
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 22,
  font: `600 14px/1 ${UI_FONT.body}`,
  cursor: "pointer",
  color: UI.text,
};
const primary: CSSProperties = { ...buttonBase, border: `1px solid ${UI.borderStrong}`, background: NAVY_FILL };
const secondary: CSSProperties = { ...buttonBase, border: `1px solid ${UI.borderStrong}`, background: "transparent" };
const quiet: CSSProperties = {
  ...buttonBase,
  border: `1px solid ${UI.border}`,
  background: "transparent",
  color: UI.textMuted,
};
