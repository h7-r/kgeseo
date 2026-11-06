import type { CSSProperties } from "react";

import { FONT, placeCentered } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { INTRO_BOTTOM_Y, INTRO_CENTER_Y, SIGNUP_FORM_LEFT, SIGNUP_FORM_WIDTH } from "./homeLayout";

// 가입 폼과 환영 판이 같은 자리·같은 단추를 쓴다.

// 왼쪽 소개 덩이·가르는 호와 같은 중심선에 맞춘다. 높이는 내용이 정한다.
export const signupPanelStyle: CSSProperties = placeCentered(SIGNUP_FORM_LEFT, INTRO_CENTER_Y, SIGNUP_FORM_WIDTH);

/** 가입 폼은 맨 아래 로그인 줄을 왼쪽 숫자 지표의 바닥선에 맞춘다. 높이가 늘면 위로 자란다. */
export const signupFormPanelStyle: CSSProperties = {
  ...signupPanelStyle,
  top: `${INTRO_BOTTOM_Y}px`,
  transform: "translateY(-100%)",
};

export const primaryButtonStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  padding: "15px 24px",
  borderRadius: "100px",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  backgroundImage:
    "linear-gradient(143.483deg, rgba(43,71,143,0.95) 0%, rgba(54,64,143,0.92) 45%, rgba(43,71,143,0.88) 100%)",
  boxShadow:
    "0px 0px 0px 1px rgba(59,94,162,0.4), 0px 0px 14px 4px rgba(50,82,150,0.4), 0px 0px 36px 12px rgba(54,64,143,0.2), 0px 4px 20px 0px rgba(48,66,131,0.38)",
};

export const primaryLabelStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "18px",
  color: COLOR.white,
  letterSpacing: "1.575px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
