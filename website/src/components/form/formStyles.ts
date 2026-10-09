import type { CSSProperties } from "react";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

/** 인증 화면 카드(card)와 홈 빠른 가입 폼(home). 같은 부품이라도 간격·색이 조금씩 다르다. */
export type FormVariant = "card" | "home";

export const fieldLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "16px",
  color: COLOR.textMuted,
  // 한글 라벨은 자간이 넓으면 글자가 흩어져 보인다.
  letterSpacing: "0.4px",
  textTransform: "uppercase",
};

const inputBoxBase: CSSProperties = {
  borderBottom: "1px solid rgba(50,82,150,0.18)",
  display: "flex",
  alignItems: "flex-start",
  // hidden 이면 칸 밖에 그리는 오류 글이 잘린다.
  overflow: "visible",
};

/** 밑줄 칸. 지역 선택 상자도 같은 밑줄을 쓴다. */
export const inputBoxStyle: Record<FormVariant, CSSProperties> = {
  card: { ...inputBoxBase, padding: "10px 32px 10px 0", width: "100%", boxSizing: "border-box" },
  home: { ...inputBoxBase, paddingTop: "10px", paddingRight: "32px" },
};

export const glossStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "100px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 55%)",
};

/** 간편 가입·로그인 글자 양옆의 가는 줄. */
export const hairlineStyle: CSSProperties = { flex: "1 0 0", height: "1px", background: "rgba(255,255,255,0.07)" };
