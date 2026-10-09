import type { CSSProperties } from "react";

import { FONT, gradientText } from "@/lib/style";
import { ROUTES, useSiteNavigate } from "@/navigation/routes";
import { COLOR, GRADIENT, SHADOW } from "@/styles/tokens";

const BENEFITS = [
  ["[01]", "나주 앙암바위 첫 번째 사건 즉시 접근"],
  ["[02]", "수사 기록 저장 및 진행 상황 동기화"],
  ["[03]", "실제 지역 방문 보상 미션 해제"],
] as const;

/** 인증 화면 오른쪽에 붙는 소개 글. */
export default function AuthIntro() {
  const navigate = useSiteNavigate();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px", width: "100%" }}>
      <div style={badgeStyle}>
        <span style={badgeTextStyle}>REGIONAL ESCAPE // COHORT 2026</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
        <div style={{ ...headlineStyle, color: "#f1f7fc" }}>ESCAPE</div>
        <div style={gradientHeadlineStyle} className="u-shine-text">
          {" THE LEGEND"}
        </div>
      </div>

      <div style={{ fontFamily: FONT.mono, fontWeight: 300, fontSize: "16px", color: COLOR.textMuted, width: "100%" }}>
        <p style={paragraphStyle}>조사관 등록을 완료하고 합동수사본부에 합류하세요.</p>
        <p style={paragraphStyle}>전국 각지에서 사라진 기록을 추적하고,</p>
        <p style={paragraphStyle}>잊혀진 전설의 진실을 밝혀낼 당신을 기다리고 있습니다.</p>
      </div>

      <div style={benefitListStyle}>
        {BENEFITS.map(([number, text]) => (
          <div key={number} style={{ display: "flex", gap: "12px", alignItems: "center", width: "100%" }}>
            <span style={{ fontFamily: FONT.mono, fontWeight: 700, color: COLOR.accent, whiteSpace: "nowrap" }}>
              {number}
            </span>
            <span style={{ flex: "1 0 0", minWidth: 0, fontFamily: FONT.mono, fontWeight: 400, color: "#f1f7fc" }}>
              {text}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "16px", alignItems: "center", width: "100%" }}>
        <button type="button" className="button" style={filledButtonStyle} onClick={() => navigate(ROUTES.about)}>
          <span className="button__label">게임 소개</span>
        </button>
        <button type="button" className="button" style={outlineButtonStyle} onClick={() => navigate(ROUTES.home)}>
          <span className="button__label">지역 탐험하기</span>
        </button>
      </div>
    </div>
  );
}

const badgeStyle: CSSProperties = {
  alignSelf: "flex-start",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  padding: "6px 12px",
  borderRadius: "4px",
  border: `1px solid ${COLOR.border}`,
};
const badgeTextStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.accent,
  letterSpacing: "2px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

// 줄 높이(100)가 글자(110)보다 작아 그라디언트가 잘린다. 칸만 위아래로 넓히고 margin 으로 되돌린다.
const headlineStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "110px",
  lineHeight: "100px",
  width: "100%",
  padding: "0.15em 0",
  margin: "-0.15em 0",
};
const gradientHeadlineStyle: CSSProperties = {
  ...headlineStyle,
  ...gradientText("linear-gradient(90deg, #325296 0%, #3b5ea2 50%, #2f3e70 100%)"),
  textShadow: "0px 0px 32px rgba(46,72,137,0.31)",
};

const paragraphStyle: CSSProperties = { margin: 0, lineHeight: "26px" };

const benefitListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  padding: "20px 0",
  width: "100%",
  fontSize: "16px",
  borderTop: `1px solid ${COLOR.border}`,
  borderBottom: `1px solid ${COLOR.border}`,
  boxSizing: "border-box",
};

const buttonBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "100px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
  cursor: "pointer",
};

const filledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: "16px 36px",
  fontWeight: 700,
  color: COLOR.white,
  backgroundImage: GRADIENT.pillButton("136.78deg"),
  boxShadow: SHADOW.pillGlowSoft,
};

const outlineButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: "16px 32px",
  fontWeight: 500,
  color: COLOR.accent,
  background: COLOR.glass,
  border: "1px solid rgba(255,255,255,0.2)",
};
