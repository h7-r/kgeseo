import type { CSSProperties } from "react";

import { UI, UI_FONT } from "./gameUi";

// 소지품 창과 힌트함이 함께 쓰는 안쪽 모양.

export const listColumnStyle: CSSProperties = { flex: "0 1 auto", minHeight: 96, overflowY: "auto" };
export const detailColumnStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 110,
  overflowY: "auto",
  padding: "16px 18px",
  borderRadius: 12,
  background: UI.surfaceRaised,
  border: `1px solid ${UI.border}`,
};

export const sectionStyle: CSSProperties = { marginBottom: 16 };
export const sectionTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  marginBottom: 10,
  font: `600 15px/1.2 ${UI_FONT.body}`,
  color: UI.text,
};
export const sectionCountStyle: CSSProperties = {
  font: `500 13px/1 ${UI_FONT.mono}`,
  color: UI.accent,
  fontVariantNumeric: "tabular-nums",
};
export const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
  gap: 10,
};

export const slotStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: 7,
  padding: "10px 6px",
  borderRadius: 10,
  background: UI.surfaceRaised,
  border: `1px solid ${UI.border}`,
  color: UI.text,
  font: `500 13px/1.3 ${UI_FONT.body}`,
  cursor: "pointer",
};
export const slotNameStyle: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
export const slotImageStyle: CSSProperties = { width: 48, height: 48, objectFit: "contain", borderRadius: 6 };
export const slotLetterStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 48,
  height: 48,
  borderRadius: 8,
  background: UI.surfaceHover,
  font: `700 22px/1 ${UI_FONT.title}`,
  color: UI.accent,
};

export const categoryStyle: CSSProperties = { font: `500 13px/1 ${UI_FONT.body}`, color: UI.accent };
export const detailNameStyle: CSSProperties = {
  margin: "8px 0 10px",
  font: `700 20px/1.3 ${UI_FONT.title}`,
  color: UI.text,
};
export const detailImageStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: 240,
  margin: "0 auto 12px",
  borderRadius: 8,
  background: UI.surface,
};
// pre-line — 설명의 \n 줄바꿈을 살린다
export const descriptionStyle: CSSProperties = {
  margin: 0,
  color: UI.text,
  font: `400 16px/1.7 ${UI_FONT.body}`,
  whiteSpace: "pre-line",
  // 낱말 중간에서 줄이 꺾이지 않게 한다
  wordBreak: "keep-all",
};

/** 아직 고른 것·가진 것이 없을 때. 아이콘과 한두 줄로 자리를 채운다. */
export const emptyStyle: CSSProperties = {
  minHeight: 96,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  textAlign: "center",
  color: UI.textMuted,
  font: `400 15px/1.7 ${UI_FONT.body}`,
};
export const emptyRowStyle: CSSProperties = { color: UI.textMuted, font: `400 15px/1.6 ${UI_FONT.body}` };
