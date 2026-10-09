import type { CSSProperties } from "react";

// 소지품 창과 힌트함이 함께 쓰는 치수·색. 생김새가 다르면 다른 게임 화면으로 읽힌다.

export const GOLD = "#e0a94e";
const MONO_SMALL = "12px ui-monospace,Menlo,monospace";

export const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 50,
  background: "rgba(10,13,18,.72)",
  display: "grid",
  placeItems: "center",
};

export const panelStyle: CSSProperties = {
  width: 720,
  maxWidth: "90%",
  maxHeight: "82%",
  display: "flex",
  flexDirection: "column",
  padding: "22px 24px",
  borderRadius: 12,
  background: "#191d25",
  border: "1px solid #2c3648",
  color: "#cfe3ff",
  font: "15px/1.7 sans-serif",
};

export const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  marginBottom: 16,
};
export const titleStyle: CSSProperties = { font: "600 22px/1.3 sans-serif" };
export const headerMetaStyle: CSSProperties = { font: MONO_SMALL, color: "#5b6b80" };
export const bodyStyle: CSSProperties = { display: "flex", gap: 20, minHeight: 0, flex: 1 };
export const sectionTitleStyle: CSSProperties = {
  font: MONO_SMALL,
  letterSpacing: 1,
  color: GOLD,
  marginBottom: 8,
};
export const sectionCountStyle: CSSProperties = { color: "#5b6b80", marginLeft: 4 };
export const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
  gap: 8,
};

export const slotStyle: CSSProperties = {
  display: "grid",
  justifyItems: "center",
  gap: 4,
  padding: "10px 6px",
  borderRadius: 8,
  background: "#12161c",
  border: "1px solid #2c343e",
  color: "#cfe3ff",
  font: "12px sans-serif",
  cursor: "pointer",
};
export const selectedSlotStyle: CSSProperties = { ...slotStyle, borderColor: GOLD, background: "#1d2430" };
export const slotNameStyle: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const categoryStyle: CSSProperties = { font: MONO_SMALL, letterSpacing: 1, color: GOLD };
export const detailNameStyle: CSSProperties = { margin: "6px 0 0", font: "600 19px/1.3 sans-serif" };
export const dividerStyle: CSSProperties = { height: 1, background: "#2c343e", margin: "14px 0" };
export const hintStyle: CSSProperties = { color: "#5b6b80", fontSize: 13, paddingTop: 6 };
export const footerStyle: CSSProperties = {
  marginTop: 16,
  textAlign: "right",
  color: "#5b6b80",
  font: MONO_SMALL,
};
