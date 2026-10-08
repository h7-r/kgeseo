import type { CSSProperties } from "react";

import { FONT, gradientText, placeCentered } from "@/lib/style";
import { ROUTES, useSiteNavigate } from "@/navigation/routes";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT, SHADOW, badgePillStyle } from "@/styles/tokens";

import { INTRO_CENTER_Y, INTRO_LEFT, INTRO_WIDTH } from "./homeLayout";

const DIVIDER = "1px solid rgba(26,48,95,0.25)";

// 디자인은 숫자를 덩이 밖에 따로 띄우고 덩이 안엔 칸막이만 둔다.
// 좌표대로 두면 행간을 넓힐 때 숫자가 단추 위로 올라타서, 칸막이 줄 안에 숫자를 넣는다.
const STATS = [
  { value: "50+", label: "전국 방탈출 맵", cellStyle: { width: "129px", paddingRight: "48px", borderRight: DIVIDER } },
  { value: "100+", label: "역사 설화 퀘스트", cellStyle: { width: "188px", padding: "0 48px", borderRight: DIVIDER } },
  { value: "∞", label: "숨겨진 보상", cellStyle: { width: "117px", paddingLeft: "48px" } },
] satisfies { value: string; label: string; cellStyle: CSSProperties }[];

/** 두 번째 화면 왼쪽 — 큰 제목, 설명, 단추, 숫자 지표. */
export default function Intro() {
  const navigate = useSiteNavigate();

  return (
    // 배지도 덩이 안에 둔다. 따로 띄우면 덩이 높이가 바뀔 때 배지만 남아 제목과 겹친다.
    <div
      style={{ ...placeCentered(INTRO_LEFT, INTRO_CENTER_Y, INTRO_WIDTH), ...columnStyle }}
      {...sectionAnchor("intro")}
    >
      <div style={badgeStyle}>
        <span style={badgeTextStyle}>2026 · REGIONAL ESCAPE ADVENTURE</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "18px" }}>
        <div style={{ ...bigTitleStyle, width: "595px", color: COLOR.textBright }}>ESCAPE</div>
        <div className="flow-text" style={legendTitleStyle}>
          THE LEGEND
        </div>
      </div>

      <div style={descriptionStyle}>
        <p style={descriptionLineStyle}>
          각 지역의 역사와 설화를 바탕으로 만들어진 몰입형 방탈출 게임. 퀘스트를 클리어하고 실제 지역을 방문하면 숨겨진
          보상이 열린다.
        </p>
        <p style={descriptionLineStyle}>
          잊혀진 지역의 이야기를 게임으로 되살리고, 당신의 발걸음으로 그 지역을 다시 빛나게 하세요.
        </p>
      </div>

      <div style={{ display: "flex", gap: "40px", alignItems: "center" }}>
        <button
          type="button"
          className="btn"
          style={{ ...filledButtonStyle, cursor: "pointer" }}
          onClick={() => navigate(ROUTES.about)}
        >
          <span className="btn__label">게임 소개</span>
        </button>
        <button
          type="button"
          className="btn"
          style={{ ...ghostButtonStyle, cursor: "pointer" }}
          onClick={() => navigate(ROUTES.media)}
        >
          <span className="btn__label">지역 탐험하기</span>
        </button>
      </div>

      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", width: "100%" }}>
        {STATS.map(({ value, label, cellStyle }) => (
          <div
            key={label}
            style={{
              ...cellStyle,
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              alignItems: "center",
              textAlign: "center",
              boxSizing: "content-box",
            }}
          >
            <div style={statValueStyle}>{value}</div>
            <div style={statLabelStyle}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const columnStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "30px", alignItems: "flex-start" };

const badgeStyle: CSSProperties = { ...badgePillStyle, alignSelf: "flex-start", gap: "12px", padding: "10px 20px" };

const badgeTextStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "18px",
  color: COLOR.accent,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

// 줄 높이(152)가 글자(180)보다 작아 그라디언트가 잘린다. 칸만 위아래로 넓혔다가 되돌린다.
const bigTitleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "180px",
  lineHeight: "152px",
  padding: "0.15em 0",
  margin: "-0.15em 0",
};

const legendTitleStyle: CSSProperties = {
  ...bigTitleStyle,
  width: "652px",
  ...gradientText(GRADIENT.titleBlue),
  textShadow: "0px 0px 40px rgba(46,72,137,0.5)",
};

const descriptionStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 300,
  fontSize: "28px",
  letterSpacing: "0.28px",
  color: COLOR.textMuted,
  width: "615px",
};

const descriptionLineStyle: CSSProperties = { margin: 0, lineHeight: "40px" };

const buttonBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "100px",
  fontFamily: FONT.mono,
  fontSize: "18px",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};

const filledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: "18px 48px",
  fontWeight: 700,
  color: COLOR.white,
  backgroundImage: GRADIENT.pillButton("139.712deg"),
  boxShadow: SHADOW.pillGlow,
};

const ghostButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: "18px 44px",
  fontWeight: 400,
  color: COLOR.accent,
  background: COLOR.glass,
  backdropFilter: "blur(7px)",
  WebkitBackdropFilter: "blur(7px)",
  border: `0.3px solid ${COLOR.white}`,
};

const statValueStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "84px",
  letterSpacing: "2px",
  lineHeight: 1,
  whiteSpace: "nowrap", // "50+" 가 쪼개지거나 ∞ 가 잘리지 않게.
  ...gradientText("linear-gradient(90deg, #3b5ea2 0%, #325296 100%)"),
};

const statLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "18px",
  letterSpacing: "0.5px",
  color: COLOR.textMuted,
  textTransform: "uppercase",
  lineHeight: "normal",
  whiteSpace: "nowrap",
};
