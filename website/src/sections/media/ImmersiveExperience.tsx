import type { CSSProperties } from "react";

import bookOpenIcon from "@/assets/images/imgBookOpen.svg";
import glowEllipse from "@/assets/images/imgEllipse13.svg";
import keyIcon from "@/assets/images/imgKey.svg";
import dividerLine from "@/assets/images/imgLine2.svg";
import navigationIcon from "@/assets/images/imgNavigation.svg";
import usersIcon from "@/assets/images/imgUsers.svg";
import ComingSoonChip from "@/components/ComingSoonChip";
import HeartbeatLine from "@/components/HeartbeatLine";
import RisingText from "@/components/RisingText";
import { depthRevealClass, useReveal, useTilt } from "@/hooks/motion";
import { useProximity } from "@/hooks/proximity";
import { fillImageStyle, FONT, glowImageStyle, gradientText } from "@/lib/style";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT } from "@/styles/tokens";

interface Feature {
  number: string;
  icon: string;
  title: string;
  description: string;
  /** 아직 열리지 않은 기능이면 제목 옆에 「출시 예정」을 단다. */
  isComingSoon?: boolean;
}

const FEATURES: readonly Feature[] = [
  {
    number: "01",
    icon: navigationIcon,
    title: "실시간 3D 탐험",
    description: "1인칭 시점으로 수사 현장 구석구석을 직접 걸으며 살펴보세요.",
  },
  {
    number: "02",
    icon: keyIcon,
    title: "정교한 퍼즐",
    description: "단서를 맞춰 보고 추론해야 풀리는, 여러 겹으로 얽힌 퍼즐.",
  },
  {
    number: "03",
    icon: bookOpenIcon,
    title: "스토리 몰입",
    description: "지역의 전설과 역사에 뿌리를 둔 깊이 있는 이야기.",
  },
  {
    number: "04",
    icon: usersIcon,
    title: "멀티플레이",
    description: "최대 4인이 함께 단서를 찾는 협동 플레이를 준비하고 있습니다.",
    isComingSoon: true,
  },
];

// 지금 사실인 숫자만 둔다. 한 판 시간은 홈 마무리 글·게임 소개와 같은 값이다.
const STATS: readonly (readonly [value: string, label: string])[] = [
  ["1", "공개 맵 · 나주"],
  ["4", "출시 예정 지역"],
  ["15~25분", "한 판 플레이"],
  ["1인칭", "실시간 3D 추리"],
];

interface ImmersiveExperienceProps {
  top?: number;
}

/**
 * 몰입 경험 구간. 화면 끝까지 닿는 각진 밝은 바탕, 아래 물결, 1480 폭 내용 칸의 세 겹이다.
 * 바탕과 내용 칸은 크기·라운드가 달라 하나로 합치면 모양이 어긋난다.
 */
export default function ImmersiveExperience({ top = 0 }: ImmersiveExperienceProps) {
  return (
    <>
      <div style={{ ...backgroundStyle, top: `${top}px` }}>
        {/* 지표 줄(약 708) 뒤로 번지는 푸른 빛과 옅은 원 두 개 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #fbfbfe 0%, #f3f4fb 60%, #eceffa 100%)",
          }}
        />
        <div style={statsGlowStyle} />
        <div style={{ ...statsRingStyle, width: "800px", height: "800px", border: "1px solid rgba(58,80,148,0.16)" }} />
        <div
          style={{ ...statsRingStyle, width: "1180px", height: "1180px", border: "1px dashed rgba(58,80,148,0.14)" }}
        />
      </div>

      <div style={{ ...waveStyle, top: `${top + 893}px` }}>
        <div style={{ position: "absolute", top: "-6.06%", bottom: "-6.06%", left: 0, right: 0 }}>
          {/* 밝은 바탕 위라 선·빛을 조금 진하게 잡는다 */}
          <HeartbeatLine
            shape="wide"
            width="100%"
            height="100%"
            color={COLOR.navyDeep}
            glowColor="#2f427b"
            strokeWidth={1.1}
            opacity={0.45}
            duration={4.2}
          />
        </div>
      </div>

      <section style={{ ...contentStyle, top: `${top}px` }} {...sectionAnchor("immersive")}>
        <div style={headingStyle}>
          {/* 흰 면 위에선 강조색(accent)이 흐려 푸터와 같은 남색을 쓴다. */}
          <div style={kickerStyle}>
            <span>CORE FEATURES</span>
          </div>
          <RisingText text="몰입감 넘치는 게임 경험" style={titleStyle} />
        </div>

        <div style={featureRowStyle}>
          {/* 카드 뒤로 번지는 큰 원 */}
          <div
            style={{
              position: "absolute",
              left: "345px",
              top: "-210px",
              width: "624px",
              height: "1152px",
              pointerEvents: "none",
            }}
          >
            <div style={{ position: "absolute", top: "-26.04%", bottom: "-26.04%", left: "-48.08%", right: "-48.08%" }}>
              <img loading="lazy" decoding="async" src={glowEllipse} alt="" style={glowEllipseStyle} />
            </div>
          </div>

          {FEATURES.map((feature, i) => (
            <FeatureCard key={feature.number} {...feature} order={i} />
          ))}
        </div>

        {/* 양끝이 투명해지는 가로선 */}
        <div
          style={{
            height: "1px",
            width: "100%",
            background: "linear-gradient(90deg, rgba(26,48,95,0) 0%, #1a305f 50%, rgba(26,48,95,0) 100%)",
          }}
        />

        <div style={statsRowStyle}>
          {STATS.map(([value, label], i) => (
            <Stat key={label} value={value} label={label} hasDivider={i < STATS.length - 1} />
          ))}
        </div>
      </section>
    </>
  );
}

interface FeatureCardProps extends Feature {
  order: number;
}

/** 차례로 떠오르고 마우스를 따라 기우는 기능 카드. */
function FeatureCard({ number, icon, title, description, isComingSoon, order }: FeatureCardProps) {
  const { ref: tiltRef, onMouseMove, onMouseLeave } = useTilt<HTMLDivElement>(4);
  const [revealRef, isVisible] = useReveal<HTMLDivElement>();
  const proximityRef = useProximity<HTMLDivElement>(240);

  return (
    <div
      ref={revealRef}
      className={`u-tilt-scene ${depthRevealClass(isVisible)}`}
      style={{ flex: "1 0 0", minWidth: 0, transitionDelay: `${order * 30}ms` }}
    >
      <div
        ref={(el) => {
          tiltRef.current = el;
          proximityRef.current = el;
        }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        className="u-tilt u-proximity-glow u-proximity-glow--inset"
        style={cardStyle}
      >
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={iconBoxStyle}>
            <img
              loading="lazy"
              decoding="async"
              src={icon}
              alt=""
              style={{ width: "18px", height: "18px", display: "block" }}
            />
          </div>
          <div style={numberBadgeStyle}>{number}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
          <div style={cardTitleRowStyle}>
            <div style={cardTitleStyle}>{title}</div>
            {isComingSoon && <ComingSoonChip style={{ fontSize: "15px" }} />}
          </div>
          <div style={cardDescriptionStyle}>{description}</div>
        </div>
      </div>
    </div>
  );
}

interface StatProps {
  value: string;
  label: string;
  hasDivider: boolean;
}

function Stat({ value, label, hasDivider }: StatProps) {
  return (
    <>
      <div style={statStyle}>
        <span style={statValueStyle}>{value}</span>
        <span style={statLabelStyle}>{label}</span>
      </div>
      {hasDivider && (
        // 지표 사이 세로 막대는 64px 가로선을 90° 돌려 세운 것이다.
        <div
          style={{
            display: "flex",
            height: "64px",
            width: 0,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ flex: "none", transform: "rotate(90deg)" }}>
            <div style={{ position: "relative", width: "64px", height: 0 }}>
              <div style={{ position: "absolute", top: "-1px", left: 0, right: 0 }}>
                <img loading="lazy" decoding="async" src={dividerLine} alt="" style={fillImageStyle} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const backgroundStyle: CSSProperties = {
  position: "absolute",
  left: "-1px",
  width: "1920px",
  height: "946px",
  background: COLOR.lightPanel,
  overflow: "hidden",
  pointerEvents: "none",
};

const statsGlowStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "708px",
  width: "760px",
  height: "860px",
  transform: "translate(-50%, -50%)",
  background:
    "radial-gradient(closest-side, rgba(84,108,214,0.62) 0%, rgba(110,132,224,0.32) 45%, rgba(140,160,232,0) 100%)",
};

const statsRingStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "708px",
  transform: "translate(-50%, -50%)",
  borderRadius: "50%",
};

const waveStyle: CSSProperties = {
  position: "absolute",
  left: "557px",
  width: "800px",
  height: "7.895px",
  pointerEvents: "none",
};

const contentStyle: CSSProperties = {
  position: "absolute",
  left: "220px",
  width: "1480px",
  padding: "80px 60px",
  borderRadius: "24px",
  display: "flex",
  flexDirection: "column",
  gap: "64px",
  alignItems: "flex-start",
  overflow: "hidden",
  boxSizing: "border-box",
};

const headingStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  alignItems: "center",
  width: "100%",
  whiteSpace: "nowrap",
};

const kickerStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.navyMuted,
  textTransform: "uppercase",
};

const titleStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 900,
  fontSize: "52px",
  textAlign: "center",
  ...gradientText("linear-gradient(90deg, #1b2855 24.519%, #556e98 65.433%, #3b5ea2 100%)"),
};

const featureRowStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  gap: "20px",
  alignItems: "flex-start",
  justifyContent: "center",
  width: "100%",
};

const glowEllipseStyle: CSSProperties = {
  ...glowImageStyle,
  // 흰 면 위에선 회보라 얼룩이라 옅게 깐다.
  opacity: 0.35,
};

const cardStyle: CSSProperties = {
  position: "relative",
  flex: "none",
  minWidth: 0,
  width: "100%",
  minHeight: "280px",
  padding: "32px",
  borderRadius: "16px",
  border: "1.5px solid rgba(46,72,137,0.6)",
  background: GRADIENT.cardDark,
  display: "flex",
  flexDirection: "column",
  // 위에서부터 같은 간격으로 쌓아야 설명 줄 수가 달라도 네 장의 제목 높이가 맞는다.
  gap: "40px",
  justifyContent: "flex-start",
  overflow: "hidden",
  boxShadow: "0px 0px 24px 0px rgba(46,72,137,0.18)",
  boxSizing: "border-box",
};

const iconBoxStyle: CSSProperties = {
  width: "40px",
  height: "40px",
  borderRadius: "20px",
  background: "rgba(46,72,137,0.12)",
  border: `1px solid ${COLOR.navy}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const numberBadgeStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: "100px",
  background: "rgba(255,255,255,0.03)",
  fontFamily: FONT.mono,
  fontSize: "16px",
  color: COLOR.textMuted,
};

const cardTitleRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "12px", width: "100%" };

const cardTitleStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "26px",
  lineHeight: 1.35,
  color: "#eef2f6",
};

const cardDescriptionStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 400,
  fontSize: "18px",
  lineHeight: 1.65,
  color: COLOR.textSubtle,
  width: "100%",
};

const statsRowStyle: CSSProperties = {
  display: "flex",
  gap: "40px",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px 0",
  width: "100%",
};

const statStyle: CSSProperties = {
  flex: "1 0 0",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  alignItems: "center",
  textAlign: "center",
  whiteSpace: "nowrap",
};

const statValueStyle: CSSProperties = {
  fontFamily: FONT.display,
  fontSize: "60px",
  ...gradientText("linear-gradient(180deg, #536c95 39.904%, #111b34 100%)"),
};

const statLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 500,
  fontSize: "16px",
  color: COLOR.lightTextMuted,
  textTransform: "uppercase",
};
