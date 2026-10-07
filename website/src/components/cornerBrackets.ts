import type { CSSProperties } from "react";

/** 히어로 판 네 귀퉁이 꺾쇠의 자리. 귀퉁이마다 가로·세로 막대 한 쌍. */
export const CORNER_BRACKETS: readonly CSSProperties[] = [
  { left: "23px", top: "23px", width: "32px", height: "2px" },
  { left: "23px", top: "23px", width: "2px", height: "32px" },
  { right: "23px", top: "23px", width: "32px", height: "2px" },
  { right: "23px", top: "23px", width: "2px", height: "32px" },
  { left: "23px", bottom: "23px", width: "32px", height: "2px" },
  { left: "23px", bottom: "23px", width: "2px", height: "32px" },
  { right: "23px", bottom: "23px", width: "32px", height: "2px" },
  { right: "23px", bottom: "23px", width: "2px", height: "32px" },
];
