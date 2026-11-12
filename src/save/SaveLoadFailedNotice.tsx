/**
 * 「저장을 불러오지 못했어요. 지금 새로고침해 주세요」 — 저장 불러오기가 실패했을 때만 화면 위쪽 가운데에 뜬다(본편 · 나주 같은 것).
 * 닫을 수 있다. 닫아도 저장은 멈춘 그대로다(gameSaveLoad) — 새로고침해야 다시 불러온다.
 * 누름이 게임(포인터 잠금 · 클릭 조작)으로 새지 않게 막는다.
 */
import { useSyncExternalStore, type CSSProperties } from "react";

import { SAVE_LOAD_FAILED_TEXT, saveLoadNotice } from "./gameSaveLoad";

const bar: CSSProperties = {
  position: "fixed",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  // 로딩 영상(100000) · 베타 설문 막(2147483000)보다 위 — 첫 화면부터 보이게
  zIndex: 2147483001,
  width: "min(560px, calc(100vw - 32px))",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "14px 16px",
  borderRadius: 14,
  background: "#fff4e5",
  border: "2px solid #c2410c",
  color: "#1c1a17",
  boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
  fontFamily: "inherit",
  lineHeight: 1.45,
};
const message: CSSProperties = { flex: "1 1 240px", minWidth: 0 };
const buttons: CSSProperties = { display: "flex", gap: 8, flex: "0 0 auto", marginLeft: "auto" };
const buttonBase: CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  padding: "10px 16px",
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid #1c1a17",
  fontFamily: "inherit",
};

function stop(event: { stopPropagation(): void }) {
  event.stopPropagation();
}

export default function SaveLoadFailedNotice() {
  const isShown = useSyncExternalStore(saveLoadNotice.subscribe, saveLoadNotice.isShown, saveLoadNotice.isShown);
  if (!isShown) return null;
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
        <div style={{ fontSize: 16, fontWeight: 700 }}>{SAVE_LOAD_FAILED_TEXT.title}</div>
        <div style={{ fontSize: 13, color: "#5c4a36", marginTop: 2 }}>{SAVE_LOAD_FAILED_TEXT.body}</div>
      </div>
      <div style={buttons}>
        <button
          type="button"
          style={{ ...buttonBase, background: "#c2410c", borderColor: "#c2410c", color: "#fff" }}
          onClick={() => window.location.reload()}
        >
          {SAVE_LOAD_FAILED_TEXT.reload}
        </button>
        <button
          type="button"
          style={{ ...buttonBase, background: "transparent", color: "#1c1a17" }}
          onClick={() => saveLoadNotice.dismiss()}
        >
          {SAVE_LOAD_FAILED_TEXT.close}
        </button>
      </div>
    </div>
  );
}
