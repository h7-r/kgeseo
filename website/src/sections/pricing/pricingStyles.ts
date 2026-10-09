import type { CSSProperties } from "react";

import { COLOR, surfaceFillStyle } from "@/styles/tokens";

export const pricingSectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "30px",
  padding: "56px",
  borderRadius: "24px",
  ...surfaceFillStyle,
  // 바탕이 불투명해 뒤 흐림은 보이지도 않으면서 다시 그릴 때마다 GPU 를 쓴다. 걸지 않는다.
  filter: "drop-shadow(0px 8px 16px rgba(47,62,112,0.13))",
  width: "100%",
  boxSizing: "border-box",
};

export const bulletStyle: CSSProperties = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: COLOR.navy,
  flexShrink: 0,
};
