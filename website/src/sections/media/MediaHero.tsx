import type { CSSProperties } from "react";

import { CORNER_BRACKETS } from "@/components/cornerBrackets";
import { FONT, gradientText } from "@/lib/style";
import { ROUTES, useSiteNavigate } from "@/navigation/routes";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT, SHADOW, badgePillStyle } from "@/styles/tokens";

interface MediaHeroProps {
  top?: number;
}

/** 게임영상·캐릭터 페이지 첫 화면. 가운데 정렬판이라 옆 영상 패널은 없다. */
export default function MediaHero({ top = 129 }: MediaHeroProps) {
  const navigate = useSiteNavigate();

  return (
    <section style={{ ...rootStyle, top: `${top}px` }} {...sectionAnchor("media-hero")}>
      {/* 캐릭터 생성 화면 녹화. 글이 읽히게 위아래·가운데를 어둡게 깐다. */}
      <video
        src="/character-film.mp4"
        poster="/character-film-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        style={videoStyle}
      />
      <div style={videoShadeStyle} aria-hidden="true" />
      {CORNER_BRACKETS.map((mark, i) => (
        <div key={i} style={{ ...cornerMarkStyle, ...mark }} />
      ))}

      <div style={contentStyle}>
        <div style={eyebrowStyle}>
          <span style={eyebrowTextStyle}>GAME &amp; CHARACTERS · ESCAPE THE LEGEND 2026</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center", width: "100%" }}>
          <div style={titleStyle}>게임영상 및 캐릭터</div>
          <div style={descriptionStyle}>게임 플레이 영상과 캐릭터 소개를 확인해보세요.</div>
        </div>

        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <button type="button" className="btn" style={filledButtonStyle} onClick={() => navigate(ROUTES.media)}>
            <span className="btn__label">트레일러 보기</span>
          </button>
          <button type="button" className="btn" style={outlineButtonStyle} onClick={() => navigate(ROUTES.media)}>
            <span className="btn__label">캐릭터 갤러리 →</span>
          </button>
        </div>
      </div>
    </section>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  left: "-7px",
  width: "1920px",
  height: "963px",
  background: COLOR.surface,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const videoStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  pointerEvents: "none",
};

// 가운데(글 자리)는 진하게, 가장자리로 갈수록 영상이 드러난다. 위아래는 페이지 바탕으로 녹인다.
const videoShadeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  background:
    "radial-gradient(ellipse 46% 52% at 50% 50%, rgba(5,11,26,0.9) 0%, rgba(5,11,26,0.68) 55%, rgba(5,11,26,0.4) 100%)," +
    "linear-gradient(180deg, rgba(5,11,26,0.85) 0%, rgba(5,11,26,0) 22%, rgba(5,11,26,0) 72%, #050b1a 100%)",
};

const cornerMarkStyle: CSSProperties = {
  position: "absolute",
  background: COLOR.navy,
  borderRadius: "1px",
  pointerEvents: "none",
};

const contentStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  alignItems: "center",
  width: "560px",
};

const eyebrowStyle: CSSProperties = { ...badgePillStyle, gap: "10px", padding: "6px 16px" };

const eyebrowTextStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.accent,
  whiteSpace: "nowrap",
};

const titleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "76px",
  lineHeight: "72px",
  width: "100%",
  textAlign: "center",
  ...gradientText("linear-gradient(90deg, #ffffff 0%, #3b5ea2 100%)"),
  // 글자(76)가 줄 높이(72)보다 커서 그라디언트 칸 밖 윗부분이 잘린다. 칸만 넓히고 같은 만큼 되돌린다.
  padding: "14px 0",
  margin: "-14px 0",
};

const descriptionStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 300,
  fontSize: "18px",
  lineHeight: "28px",
  color: COLOR.textMuted,
  textAlign: "center",
  width: "547px",
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
  cursor: "pointer",
  boxSizing: "border-box",
};

const filledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: "14px 36px",
  fontWeight: 700,
  color: COLOR.white,
  backgroundImage: GRADIENT.pillButton("140deg"),
  boxShadow: SHADOW.pillGlowSoft,
};

const outlineButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: "14px 32px",
  fontWeight: 400,
  color: COLOR.accent,
  background: COLOR.glass,
  border: "1px solid rgba(255,255,255,0.2)",
};
