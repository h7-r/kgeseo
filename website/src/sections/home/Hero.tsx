import { Suspense, lazy, useCallback, useEffect, useState, type CSSProperties } from "react";

import { useMouseParallax } from "@/hooks/motion";
import { prefersReducedMotion } from "@/lib/motionPreference";
import { FONT, gradientText } from "@/lib/style";
import { START_GAME, useSiteNavigate } from "@/navigation/routes";
import { COLOR, GRADIENT } from "@/styles/tokens";

import HeroVideoFrame from "./HeroVideoFrame";

// three.js 를 첫 번들에서 뺀다. 받는 동안은 같은 포스터가 보인다.
const HeroVideo = lazy(() => import("@/sections/home/HeroVideo"));

const DESCRIPTION = "지역의 전설 속으로 들어가 지워진 기록을 되찾는 1인칭 방탈출 어드벤처";

// 예고편이 어떤 이유로든 끝을 알리지 못해도 이 뒤에는 끝 화면을 띄운다(영상은 약 17초).
const TRAILER_SAFETY_MS = 40000;

/** trailer: 예고편이 흐르는 동안 글을 숨긴다 · end: 로고가 왜곡되며 뜨고 설명·단추가 따라온다. */
type HeroPhase = "trailer" | "end";

interface HeroProps {
  top?: number;
}

/**
 * 첫 화면. 게임 예고편이 글 없이 흐르고, 암전·끊김 뒤에 ESCAPE THE LEGEND 로고가 왜곡되며 떠오른다.
 * 글은 처음부터 DOM 에 있다(검색·화면 읽기용) — 예고편 동안은 보이지만 않는다.
 * 동작 줄이기는 바로 끝 화면이다. 단추로 탭 이동하거나 스크롤로 떠났다 돌아와도 끝 화면을 당겨 띄운다.
 */
export default function Hero({ top = 173 }: HeroProps) {
  const navigate = useSiteNavigate();
  // 조준선이 가장 많이, 제목은 아주 조금만 움직인다. 글자가 많이 흔들리면 읽기 힘들다.
  const stageRef = useMouseParallax<HTMLElement>(16);
  const [isStill] = useState(prefersReducedMotion);
  const [phase, setPhase] = useState<HeroPhase>(isStill ? "end" : "trailer");
  const isEnded = phase === "end";
  const [canReplay, setCanReplay] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const reveal = useCallback(() => setPhase("end"), []);
  const handleEnd = useCallback((isReplayable: boolean) => {
    setCanReplay(isReplayable);
    setPhase("end");
  }, []);
  const replay = () => {
    setPhase("trailer");
    setReplayKey((key) => key + 1);
  };

  useEffect(() => {
    if (isEnded) return;
    const safety = window.setTimeout(reveal, TRAILER_SAFETY_MS);
    // 예고편 도중 아래로 내려갔다가 맨 위로 돌아오면 기다리게 하지 않는다.
    let wasAway = false;
    const handleScroll = () => {
      if (window.scrollY > window.innerHeight * 0.5) wasAway = true;
      else if (wasAway && window.scrollY < window.innerHeight * 0.15) reveal();
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.clearTimeout(safety);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [isEnded, reveal]);

  return (
    <section
      ref={stageRef}
      className="hero"
      data-phase={phase}
      data-still={isStill ? "" : undefined}
      style={{ ...sectionStyle, top: `${top}px`, transformOrigin: "center 38%", willChange: "transform, opacity" }}
    >
      {/* 제목·조준선(zIndex 1) 뒤(zIndex 0)에 깔린다. */}
      <Suspense fallback={<HeroVideoFrame isEnded={isEnded} />}>
        <HeroVideo onEnd={handleEnd} replayKey={replayKey} isEnded={isEnded} />
      </Suspense>

      <div
        className="u-parallax hero__crosshair"
        data-depth="1"
        style={{ ...crosshairVerticalStyle, pointerEvents: "none", zIndex: 1 }}
      />
      <div
        className="u-parallax hero__crosshair"
        data-depth="1"
        style={{ ...crosshairHorizontalStyle, pointerEvents: "none", zIndex: 1 }}
      />

      {/* 빈 칸이지만 지우면 아래 제목이 위로 밀린다. */}
      <div style={{ width: "74px", height: "48px", flexShrink: 0, position: "relative", zIndex: 1 }} />

      {/* ESCAPE 와 THE LEGEND 가 한 칸에 겹쳐 놓여 있다. */}
      <div
        className="u-parallax"
        data-depth="0.22"
        style={{ position: "relative", zIndex: 1, width: "470px", height: "233.3px", flexShrink: 0 }}
      >
        {/* 로고만 따로 흔든다 — 바깥 칸의 transform 은 마우스 시차가 쓴다. */}
        <h1 className="hero__logo" style={logoStyle}>
          <span
            className="u-shine-text u-shine-text--solid"
            style={{ ...titleBaseStyle, left: "86px", top: 0, width: "298px", color: COLOR.textBright }}
          >
            ESCAPE
          </span>
          <span className="u-shine-text u-shine-text--navy" style={legendTitleStyle}>
            THE LEGEND
          </span>
        </h1>
      </div>

      <div
        className="u-parallax hero__lead"
        data-depth="0.12"
        style={{ ...descriptionStyle, position: "relative", zIndex: 1 }}
      >
        {/* 그림자 글은 ::before 가 data-text 를 복사해 그린다. 글을 바꿀 땐 두 곳을 같이 바꾼다. */}
        <span className="hero__description" data-text={DESCRIPTION}>
          {DESCRIPTION}
        </span>
      </div>

      <button
        type="button"
        className="button button--gradient-label hero__play"
        style={{ ...playButtonStyle, cursor: "pointer", position: "relative", zIndex: 1 }}
        onClick={() => navigate(START_GAME)}
        onFocus={reveal}
      >
        <span className="button__label hero__play-label">플레이하기</span>
      </button>

      {isEnded && canReplay && (
        <button type="button" className="hero__replay" style={replayButtonStyle} onClick={replay}>
          <span aria-hidden="true">↻</span> 예고편 다시 보기
        </button>
      )}
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

const logoStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  margin: 0,
  fontWeight: "inherit",
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
  // 회색 본부실 영상 위라 흰 글에 짙고 부드러운 그림자를 깐다. 입체감은 바닥에 눕는 그림자(.hero__description)가 준다.
  color: COLOR.textBright,
  textShadow: "0 2px 18px rgba(1,4,10,0.85), 0 0 3px rgba(1,4,10,0.7)",
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
  // 호버 때 글자가 7% 커지는데 .button 이 overflow: hidden 이라 좌우 여유가 없으면 양 끝이 잘린다.
  padding: "0 32px",
};

// 끝 화면 오른쪽 아래의 작은 글 단추. 로고·플레이하기와 겨루지 않게 흐리게 둔다.
const replayButtonStyle: CSSProperties = {
  position: "absolute",
  // 히어로 아래쪽은 첫 화면 밖이다(1149 중 약 900 까지 보인다) — 보이는 자리에 둔다.
  right: "120px",
  bottom: "330px",
  zIndex: 1,
  display: "inline-flex",
  alignItems: "center",
  gap: "10px",
  padding: "10px 18px",
  fontFamily: FONT.display,
  fontSize: "20px",
  letterSpacing: "1px",
  color: COLOR.textBright,
  background: "rgba(1,4,10,0.35)",
  border: "1px solid rgba(159,178,234,0.35)",
  borderRadius: "999px",
  cursor: "pointer",
};
