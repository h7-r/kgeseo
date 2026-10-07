import { Suspense, lazy, type CSSProperties } from "react";

import { CORNER_BRACKETS } from "@/components/cornerBrackets";
import { useMouseParallax } from "@/hooks/motion";
import { FONT, gradientText } from "@/lib/style";
import { START_GAME, useSiteNavigate } from "@/navigation/routes";
import { COLOR, GRADIENT } from "@/styles/tokens";

import HeroVideoPlaceholder from "./HeroVideoPlaceholder";

// three.js 를 첫 번들에서 뺀다. 받는 동안은 같은 포스터가 보인다.
const HeroVideo = lazy(() => import("@/sections/home/HeroVideo"));

const DESCRIPTION = "이스케이프 더 레전드는 지역의 전설 속으로 떠나는 몰입형 방탈출 어드벤처 게임입니다.";

interface HeroProps {
  top?: number;
}

/** 첫 화면. 푸른 판 위에 ESCAPE THE LEGEND 가 놓이고 뒤로 스크럽 영상이 흐른다. */
export default function Hero({ top = 173 }: HeroProps) {
  const navigate = useSiteNavigate();
  // 조준선·꺾쇠가 가장 많이, 제목은 아주 조금만 움직인다. 글자가 많이 흔들리면 읽기 힘들다.
  const stageRef = useMouseParallax<HTMLElement>(16);

  return (
    <section
      ref={stageRef}
      style={{ ...sectionStyle, top: `${top}px`, transformOrigin: "center 38%", willChange: "transform, opacity" }}
    >
      {/* 제목·조준선(zIndex 1) 뒤(zIndex 0)에 깔린다. */}
      <Suspense fallback={<HeroVideoPlaceholder />}>
        <HeroVideo />
      </Suspense>

      <div
        className="parallax-layer"
        data-depth="1"
        style={{ ...crosshairVerticalStyle, pointerEvents: "none", zIndex: 1 }}
      />
      <div
        className="parallax-layer"
        data-depth="1"
        style={{ ...crosshairHorizontalStyle, pointerEvents: "none", zIndex: 1 }}
      />

      {CORNER_BRACKETS.map((style, i) => (
        <div
          key={i}
          className="parallax-layer"
          data-depth="0.75"
          style={{
            position: "absolute",
            background: COLOR.black,
            borderRadius: "1px",
            pointerEvents: "none",
            zIndex: 1,
            ...style,
          }}
        />
      ))}

      {/* 빈 칸이지만 지우면 아래 제목이 위로 밀린다. */}
      <div style={{ width: "74px", height: "48px", flexShrink: 0, position: "relative", zIndex: 1 }} />

      {/* ESCAPE 와 THE LEGEND 가 한 칸에 겹쳐 놓여 있다. */}
      <div
        className="parallax-layer"
        data-depth="0.22"
        style={{ position: "relative", zIndex: 1, width: "470px", height: "233.3px", flexShrink: 0 }}
      >
        <div
          className="stripe-text"
          style={{ ...titleBaseStyle, left: "86px", top: 0, width: "298px", color: COLOR.textBright }}
        >
          ESCAPE
        </div>
        <div className="flow-text navy-band" style={legendTitleStyle}>
          THE LEGEND
        </div>
      </div>

      <div
        className="parallax-layer"
        data-depth="0.12"
        style={{ ...descriptionStyle, position: "relative", zIndex: 1 }}
      >
        {/* 그림자 글은 ::before 가 data-text 를 복사해 그린다. 글을 바꿀 땐 두 곳을 같이 바꾼다. */}
        <span className="floor-shadow" data-text={DESCRIPTION}>
          {DESCRIPTION}
        </span>
      </div>

      <button
        type="button"
        className="btn btn-text-glow"
        style={{ ...playButtonStyle, cursor: "pointer", position: "relative", zIndex: 1 }}
        onClick={() => navigate(START_GAME)}
      >
        <span className="btn__label play-label">플레이하기</span>
      </button>
    </section>
  );
}

const sectionStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  transform: "translateX(-50%)",
  width: "1920px",
  height: "1149px",
  background: "#43587f",
  overflow: "hidden",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
};

const CROSSHAIR_CLEAR = "rgba(46,72,137,0)";
const CROSSHAIR_MID = "rgba(46,72,137,0.25)";

const crosshairVerticalStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "calc(50% + 20.5px)",
  transform: "translate(-50%, -50%)",
  width: "2px",
  height: "200px",
  borderRadius: "1px",
  background: `linear-gradient(180deg, ${CROSSHAIR_CLEAR} 0%, ${CROSSHAIR_MID} 50%, ${CROSSHAIR_CLEAR} 100%)`,
};

const crosshairHorizontalStyle: CSSProperties = {
  position: "absolute",
  left: "calc(50% + 20px)",
  top: "calc(50% + 0.5px)",
  transform: "translate(-50%, -50%)",
  width: "200px",
  height: "2px",
  borderRadius: "1px",
  background: `linear-gradient(90deg, ${CROSSHAIR_CLEAR} 0%, ${CROSSHAIR_MID} 50%, ${CROSSHAIR_CLEAR} 100%)`,
};

const titleBaseStyle: CSSProperties = {
  position: "absolute",
  fontFamily: FONT.display,
  fontSize: "130px",
  lineHeight: "130px",
  height: "117px",
  whiteSpace: "nowrap",
};

const legendTitleStyle: CSSProperties = {
  ...titleBaseStyle,
  left: 0,
  top: "116.3px",
  width: "470px",
  ...gradientText(GRADIENT.titleBlue),
  textShadow: "0px 0px 40px rgba(46,72,137,0.5)",
};

const descriptionStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "38px",
  lineHeight: "150px",
  // 밝은 영상 위라 검정. 입체감은 바닥에 눕는 그림자(.floor-shadow)가 준다.
  color: COLOR.black,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const playButtonStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "44px",
  lineHeight: "150px",
  letterSpacing: "9px",
  // 파란 면 위 검정은 2.9:1 로 묻힌다. 흰색이면 5.6:1.
  color: COLOR.white,
  whiteSpace: "nowrap",
  flexShrink: 0,
  // 호버 때 글자가 7% 커지는데 .btn 이 overflow: hidden 이라 좌우 여유가 없으면 양 끝이 잘린다.
  padding: "0 32px",
};
