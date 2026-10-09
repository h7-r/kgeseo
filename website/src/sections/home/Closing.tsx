import type { CSSProperties } from "react";

import ambientGlow from "@/assets/images/imgAmbientRadialGlowRight.svg";
import thinLine from "@/assets/images/imgLine1.svg";
import HeartbeatLine from "@/components/HeartbeatLine";
import RisingText from "@/components/RisingText";
import RotatingText from "@/components/RotatingText";
import { revealClass, useReveal } from "@/hooks/motion";
import { fillImageStyle, FONT, glowImageStyle, gradientText } from "@/lib/style";
import { START_GAME, useSiteNavigate } from "@/navigation/routes";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT, badgePillStyle } from "@/styles/tokens";

/** 시작 단추 밑에서 도는 안내 — 「지금 눌러도 되나」 망설이게 하는 것들을 짚는다. */
const START_NOTES = [
  "브라우저에서 바로 시작합니다. 설치할 것이 없습니다.",
  "한 판은 15~25분. 앉은 자리에서 끝납니다.",
  "혼자 하는 1인칭 추리입니다. 일행을 모으지 않아도 됩니다.",
  "저장은 자동입니다. 중간에 나가도 이어서 할 수 있습니다.",
  "WebGL 을 지원하는 PC 브라우저면 됩니다.",
];

/** 마지막으로 미는 구간. 위아래에 심전도 선이 붙는다. */
export default function Closing() {
  const navigate = useSiteNavigate();
  const [sectionRef, isVisible] = useReveal<HTMLElement>();
  // 신호를 제목 칸 하나로 모아야 스크롤을 빨리 내려도 네 덩이의 순서가 뒤집히지 않는다.
  const [textRef, isTextVisible] = useReveal("0px 0px 30% 0px");

  return (
    <section
      ref={sectionRef}
      className={`${revealClass(isVisible)} u-stagger${isTextVisible ? " is-active" : ""}`}
      style={sectionStyle}
      {...sectionAnchor("start")}
    >
      <div
        style={{
          position: "absolute",
          left: "555px",
          top: "-36px",
          width: "798px",
          height: "815px",
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "absolute", top: "-30.67%", bottom: "-30.67%", left: "-31.33%", right: "-31.33%" }}>
          <img loading="lazy" decoding="async" src={ambientGlow} alt="" style={glowImageStyle} />
        </div>
      </div>

      {/* 칸을 10 으로 두면 맥의 봉우리가 구간 위 테두리에 잘린다. 담는 칸만 넉넉히 준다. */}
      <div
        style={{
          display: "flex",
          height: "28px",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          position: "relative",
        }}
      >
        <HeartbeatLine shape="upper" width="800px" height="14px" duration={3.8} opacity={0.5} strokeWidth={2.6} />
      </div>

      <div style={bodyStyle}>
        <div style={tagStyle}>
          <span
            style={{
              fontFamily: FONT.mono,
              fontSize: "18px",
              color: COLOR.white,
              letterSpacing: "2px",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            ARE YOU READY TO ESCAPE?
          </span>
        </div>

        <div ref={textRef} style={titleBlockStyle}>
          <RisingText text="전설이 당신을 기다립니다." style={titleStyle} textClassName="u-shine-text" />
          {/* 앞의 빈 줄 둘은 디자인 간격이다. 줄바꿈은 폭에 맡기면 글꼴에 따라 엉뚱한 곳에서 끊겨 <br /> 로 정한다. */}
          <div className="u-stagger__item u-stagger__item--step-1" style={subtitleStyle}>
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>{"​"}</p>
            <p style={{ margin: 0 }}>
              지금 바로 당신의 본능과 지혜를 시험해 보세요.
              <br />
              3D 입체 공간에서 시작되는 가장 신비로운
            </p>
            <p style={{ margin: 0 }}>방탈출 어드벤처</p>
          </div>
        </div>

        <div
          className="u-stagger__item u-stagger__item--step-2"
          style={{ display: "flex", flexDirection: "column", gap: "40px", alignItems: "center" }}
        >
          <div>
            <button
              type="button"
              className="button button--outline-light"
              style={startButtonStyle}
              onClick={() => navigate(START_GAME)}
            >
              <span className="button__label">지금 시작하기</span>
            </button>
          </div>
          <RotatingText
            lines={START_NOTES}
            interval={3800}
            style={{ width: "460px", textAlign: "center" }}
            lineStyle={noteStyle}
          />
        </div>
      </div>

      <div
        className="u-stagger__item u-stagger__item--step-3"
        style={{
          display: "flex",
          height: "60px",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <ThinLine />
        <div style={{ position: "relative", width: "288px", height: "20px" }}>
          {/* 위 선과 늦춤을 달리 줘서 두 줄이 번갈아 뛴다. */}
          <HeartbeatLine
            shape="large"
            width="346px"
            height="21px"
            duration={3.8}
            delay={1.6}
            opacity={0.6}
            strokeWidth={1.6}
            style={{ position: "absolute", left: "-29px", top: 0 }}
          />
        </div>
        <ThinLine />
      </div>
    </section>
  );
}

function ThinLine() {
  return (
    <div style={{ position: "relative", width: "400px", height: 0 }}>
      <div style={{ position: "absolute", top: "-1px", left: 0, right: 0 }}>
        <img loading="lazy" decoding="async" src={thinLine} alt="" style={fillImageStyle} />
      </div>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  position: "absolute",
  // 폭 1908 을 1920 한가운데에 둔다.
  left: "6px",
  top: "7493px",
  width: "1908px",
  height: "995px",
  // 통짜 검정이면 뒤의 입체 공간이 다 가려진다. 글이 읽힐 만큼만 덮는다.
  background: "rgba(1,4,10,0.82)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const bodyStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: "60px",
  alignItems: "center",
  justifyContent: "center",
  padding: "102px 120px 50px",
  width: "100%",
  boxSizing: "border-box",
};

const tagStyle: CSSProperties = { ...badgePillStyle, gap: "8px", padding: "8px 16px" };

const titleBlockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  alignItems: "center",
  minHeight: "278px",
  textAlign: "center",
  width: "100%",
};

const titleStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "112px",
  // 글자보다 작은 행간이면 윗부분이 잘린다. 1.18 이 디자인 줄 간격을 지키면서 안 잘리는 값이다.
  lineHeight: 1.18,
  paddingTop: "6px",
  letterSpacing: "4px",
  whiteSpace: "nowrap",
  textShadow: "0px 0px 30px rgba(46,72,137,0.31)",
  ...gradientText(GRADIENT.titleNavy),
};

const subtitleStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 300,
  fontSize: "26px",
  lineHeight: 1.55,
  color: COLOR.textSubtle,
  letterSpacing: "0px",
  // 모노 글꼴은 띄어쓰기가 한 글자만큼 넓어 단어 사이만 좁힌다.
  wordSpacing: "-0.3em",
  whiteSpace: "nowrap",
};

const noteStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "17px",
  lineHeight: 1.5,
  color: COLOR.white,
  letterSpacing: "0px",
  wordSpacing: "-0.3em",
  display: "block",
};

const startButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px 56px",
  borderRadius: "100px",
  fontFamily: FONT.display,
  fontWeight: 400,
  fontSize: "36px",
  color: COLOR.white,
  letterSpacing: "2px",
  whiteSpace: "nowrap",
  // 흰 테두리 + 검정 속 — 파란 면보다 페이지 톤에 맞는다.
  background: COLOR.black,
  border: `1.5px solid ${COLOR.white}`,
  boxSizing: "border-box",
  boxShadow: "0px 0px 28px 0px rgba(255,255,255,0.10)",
  cursor: "pointer",
};
