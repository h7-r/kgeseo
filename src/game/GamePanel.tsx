import type { CSSProperties, ReactNode } from "react";

import { useTouchMode } from "@/engine/input";

import { CloseIcon } from "./gameIcons";
import { DOCK_EDGE, DOCK_TOP, PANEL_SHADOW, UI, UI_FONT, keyCapStyle } from "./gameUi";

import "./gameUi.css";

interface GamePanelProps {
  title: string;
  /** 제목 오른쪽 작은 수치 */
  meta: string;
  /** 닫는 키. 창마다 다르다 */
  closeKey: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * 소지품·힌트함이 함께 쓰는 틀. 왼쪽에 붙어 열려 게임 화면을 가리지 않는다.
 * 휴대폰(터치)은 높이가 393 안팎이라 목록 | 상세를 좌우로 나누고, 위쪽 끝까지 쓴다(오른쪽 위 단추 줄은 비켜 둔다).
 * 닫기 44px, 키보드 안내 줄은 뺀다(14회차).
 */
export default function GamePanel({ title, meta, closeKey, onClose, children }: GamePanelProps) {
  const isTouch = useTouchMode();
  return (
    <div className="game-panel-backdrop" style={backdropStyle} onClick={onClose}>
      <div
        className={isTouch ? "game-panel is-touch" : "game-panel"}
        style={isTouch ? { ...panelStyle, ...touchPanelStyle } : panelStyle}
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={isTouch ? { ...headerStyle, paddingBottom: 8 } : headerStyle}>
          <h2 style={isTouch ? { ...titleStyle, fontSize: 20 } : titleStyle}>{title}</h2>
          <span style={metaStyle}>{meta}</span>
          <button
            type="button"
            className="game-icon-button"
            style={isTouch ? { ...closeStyle, width: 44, height: 44, borderRadius: 22 } : closeStyle}
            onClick={onClose}
            aria-label="닫기"
          >
            <CloseIcon />
          </button>
        </header>
        <div style={isTouch ? { ...bodyStyle, flexDirection: "row", gap: 12, paddingTop: 10 } : bodyStyle}>
          {children}
        </div>
        {!isTouch && (
          <footer style={footerStyle}>
            <kbd style={keyCapStyle}>{closeKey}</kbd>
            <kbd style={keyCapStyle}>ESC</kbd>
            <span>닫기</span>
          </footer>
        )}
      </div>
    </div>
  );
}

// 휴대폰 — 안전 영역 안 왼쪽 위부터, 오른쪽 위 HUD 단추 줄(약 230px)은 비켜 둔다
const touchPanelStyle: CSSProperties = {
  left: "calc(env(safe-area-inset-left, 0px) + 12px)",
  top: "calc(env(safe-area-inset-top, 0px) + 8px)",
  width: "min(680px, calc(100% - 252px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))",
  maxHeight: "calc(100% - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
  height: "calc(100% - 20px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
  padding: "10px 12px 12px 16px",
};

// 바깥을 누르면 닫히게 화면 전체를 받되, 어둡게 덮지 않는다.
const backdropStyle: CSSProperties = { position: "absolute", inset: 0, zIndex: 50 };

const panelStyle: CSSProperties = {
  position: "absolute",
  left: DOCK_EDGE,
  top: DOCK_TOP,
  width: `min(440px, calc(100% - ${DOCK_EDGE * 2}px))`,
  maxHeight: `calc(100% - ${DOCK_TOP + DOCK_EDGE}px)`,
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
  padding: "20px 22px 16px",
  borderRadius: 16,
  background: UI.surface,
  border: `1px solid ${UI.border}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  font: `400 16px/1.7 ${UI_FONT.body}`,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  paddingBottom: 14,
  borderBottom: `1px solid ${UI.border}`,
};
const titleStyle: CSSProperties = { margin: 0, font: `700 24px/1.15 ${UI_FONT.title}`, color: UI.text };
const metaStyle: CSSProperties = {
  marginLeft: "auto",
  font: `500 14px/1 ${UI_FONT.mono}`,
  color: UI.textMuted,
  fontVariantNumeric: "tabular-nums",
};
const closeStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  borderRadius: 18,
  border: `1px solid ${UI.border}`,
  background: "transparent",
  color: UI.textMuted,
  cursor: "pointer",
};
const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  flex: 1,
  minHeight: 0,
  paddingTop: 14,
};
const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
  paddingTop: 12,
  color: UI.textMuted,
  font: `400 13px/1 ${UI_FONT.body}`,
};
