import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR, GRADIENT } from "@/styles/tokens";

/** 어두운 면 알약 단추의 남색 그라디언트. */
export const BUTTON_GRADIENT = GRADIENT.navyButton("166deg");

/** 마이페이지·요금제 모달 아래쪽 단추. */
export const modalPrimaryStyle: CSSProperties = {
  padding: "12px 26px",
  borderRadius: "100px",
  border: "1px solid rgba(59,94,162,0.5)",
  backgroundImage: BUTTON_GRADIENT,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "15px",
  color: COLOR.white,
  cursor: "pointer",
};

export const modalSecondaryStyle: CSSProperties = {
  ...modalPrimaryStyle,
  backgroundImage: "none",
  background: "transparent",
  border: "1px solid #3a4258",
  color: COLOR.textMuted,
  fontWeight: 400,
};
