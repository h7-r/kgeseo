import type { CSSProperties } from "react";

import { usePuzzlePanel } from "./puzzlePanel";

/** 퍼즐 안내판 — 화면 오른쪽 가운데. 퍼즐이 올린 제목 · 규칙 · 상태 줄 · 그림을 그대로 보여 준다. Canvas 밖 DOM 층 */
export default function PuzzlePanelHud() {
  const panel = usePuzzlePanel();
  if (!panel) return null;
  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{panel.title}</div>
      <div style={ruleStyle}>{panel.rule}</div>
      {panel.diagram && <div style={diagramStyle}>{panel.diagram}</div>}
      {panel.rows && panel.rows.length > 0 && (
        <div style={rowsStyle}>
          {panel.rows.map((row) => (
            <div key={row.label} style={rowStyle}>
              <span style={labelStyle}>{row.label}</span>
              <span style={{ ...valueStyle, color: row.ok ? "#F2C89A" : "#F2EEE4" }}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';

const cardStyle: CSSProperties = {
  position: "absolute",
  right: 24,
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 24,
  width: 250,
  padding: "14px 16px",
  borderRadius: 12,
  background: "rgba(14,18,26,.78)",
  color: "#F2EEE4",
  font: `500 13px/1.5 ${FONT}`,
  pointerEvents: "none",
  boxShadow: "0 8px 28px rgba(0,0,0,.3)",
};

const titleStyle: CSSProperties = { font: `700 15px/1.3 ${FONT}`, color: "#F2C89A", marginBottom: 6 };
const ruleStyle: CSSProperties = { color: "#CFD6D4", whiteSpace: "pre-line", marginBottom: 8 };
const diagramStyle: CSSProperties = { display: "grid", placeItems: "center", margin: "4px 0 8px" };
const rowsStyle: CSSProperties = { display: "grid", gap: 4, borderTop: "1px solid rgba(242,238,228,.14)", paddingTop: 8 };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10 };
const labelStyle: CSSProperties = { color: "#A9B3B0" };
const valueStyle: CSSProperties = { font: `600 13px/1.5 ${FONT}`, textAlign: "right" };
