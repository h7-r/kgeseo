import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

// 흰 면 위 쪽번호(게임 소개 · 고객센터 공지)가 같이 쓴다.

export const pagerArrowStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: FONT.body,
  fontWeight: 400,
  fontSize: "28px",
  color: "#4a5263",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const pageBaseStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  borderRadius: "18px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: FONT.mono,
  fontSize: "18px",
  boxSizing: "border-box",
  cursor: "pointer",
};

// 흰 글자가 6.3:1 로 또렷하게 읽히는 진한 남색을 바탕으로 쓴다.
export const activePageStyle: CSSProperties = {
  ...pageBaseStyle,
  background: COLOR.navyDeep,
  color: COLOR.white,
  fontWeight: 700,
};

export const inactivePageStyle: CSSProperties = {
  ...pageBaseStyle,
  border: "1px solid #d1d6e0",
  color: COLOR.lightTextMuted,
  fontWeight: 400,
};
