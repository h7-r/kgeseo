import type { CSSProperties, ReactNode } from "react";

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

/** 소지품·힌트함이 함께 쓰는 틀. 왼쪽에 붙어 열려 게임 화면을 가리지 않는다. */
export default function GamePanel({ title, meta, closeKey, onClose, children }: GamePanelProps) {
  return (
    <div className="game-panel-backdrop" style={backdropStyle} onClick={onClose}>
      <div
        className="game-panel"
        style={panelStyle}
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 style={titleStyle}>{title}</h2>
          <span style={metaStyle}>{meta}</span>
          <button type="button" className="game-icon-button" style={closeStyle} onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </header>
        <div style={bodyStyle}>{children}</div>
        <footer style={footerStyle}>
          <kbd style={keyCapStyle}>{closeKey}</kbd>
          <kbd style={keyCapStyle}>ESC</kbd>
          <span>닫기</span>
        </footer>
      </div>
    </div>
  );
}

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
