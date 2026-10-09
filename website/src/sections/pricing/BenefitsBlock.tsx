import type { CSSProperties } from "react";

import benefitImage from "@/assets/images/imgBenefitImage.webp";
import benefitImageSmall from "@/assets/images/imgBenefitImage1.webp";
import DividerArc from "@/components/DividerArc";
import RotatingText from "@/components/RotatingText";
import { PRICING } from "@/data/pricing";
import { FONT, gradientText } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT } from "@/styles/tokens";

import BlockHeader from "./BlockHeader";
import { pricingSectionStyle, bulletStyle } from "./pricingStyles";

// 작은 그림이 끝나는 x(849)와 글이 시작하는 x(1184)의 한가운데. 혜택 칸 안쪽 기준이다.
const ARC_CENTER_X = Math.round((849 + 1184) / 2);

/** 혜택 안내 덩이 */
export default function BenefitsBlock() {
  return (
    // 높이를 못 박지 않아 글이 늘어도 덩이가 같이 늘어난다.
    <section style={{ ...pricingSectionStyle, gap: "40px" }} {...sectionAnchor("benefits")}>
      <BlockHeader
        eyebrow="Benefits"
        title="혜택 안내"
        description="구독 혜택을 한눈에 확인하고, 시즌 드롭을 미리 준비하세요."
      />
      <div style={benefitsRowStyle}>
        <div style={{ width: "520px", height: "356px", borderRadius: "16px", overflow: "hidden", flexShrink: 0 }}>
          <img loading="lazy" decoding="async" src={benefitImage} alt="" style={coverImageStyle} />
        </div>
        <div style={smallImageBoxStyle}>
          <img loading="lazy" decoding="async" src={benefitImageSmall} alt="" style={coverImageStyle} />
        </div>
        {/* 칸 높이가 내용(≈487)만큼이라 호(360)를 글 덩이 한가운데(≈264)에 맞춰 84 에서 시작한다. */}
        <DividerArc centerX={ARC_CENTER_X} top={84} height={360} />
        <div style={{ width: "403px", marginLeft: "335px", display: "flex", flexDirection: "column", gap: "22px" }}>
          <div
            style={{
              fontFamily: FONT.display,
              fontSize: "36px",
              lineHeight: 1.2,
              ...gradientText(GRADIENT.titleFrost),
            }}
          >
            {PRICING.benefitsTitle}
          </div>

          <div style={{ fontFamily: FONT.mono, fontSize: "16px", lineHeight: 1.75, color: COLOR.textMuted }}>
            {PRICING.benefitsIntro}
          </div>

          <div
            style={{
              height: "1px",
              background: "linear-gradient(90deg, rgba(46,72,137,0.4) 0%, rgba(46,72,137,0) 100%)",
            }}
          />

          <RotatingText
            lines={PRICING.rotatingBenefits}
            interval={4200}
            style={{ minHeight: "46px" }}
            lineStyle={{ fontFamily: FONT.mono, fontSize: "16px", lineHeight: 1.5, color: COLOR.accent }}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {PRICING.benefitPoints.map(({ text, note }) => (
              <div key={text} style={{ display: "flex", gap: "12px", alignItems: "baseline" }}>
                <span style={{ ...bulletStyle, alignSelf: "center" }} />
                <span
                  style={{
                    fontFamily: FONT.mono,
                    fontWeight: 700,
                    fontSize: "16px",
                    color: "#e3e8ef",
                    whiteSpace: "nowrap",
                  }}
                >
                  {text}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.textMuted }}>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// 상자에 담고 높이를 박으면 글이 길 때 삐져나와 위 구분선 한 줄만 둔다.
// 좌우 32 는 그림·글·호의 가로 자리(849 / 1184)를 지키는 값이다.
const benefitsRowStyle: CSSProperties = {
  display: "flex",
  gap: "0px",
  alignItems: "center",
  position: "relative",
  padding: "48px 32px 8px",
  borderTop: "1px solid rgba(46,72,137,0.28)",
  width: "1587px",
  boxSizing: "border-box",
};

const smallImageBoxStyle: CSSProperties = {
  width: "249px",
  height: "195px",
  marginLeft: "48px",
  alignSelf: "flex-end",
  marginBottom: "7px",
  borderRadius: "16px",
  overflow: "hidden",
  flexShrink: 0,
};

const coverImageStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
