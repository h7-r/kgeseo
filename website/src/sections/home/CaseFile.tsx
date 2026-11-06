import type { CSSProperties } from "react";

import ComingSoonChip from "@/components/ComingSoonChip";
import { useScrollToSection } from "@/layout/headerScroll";
import { SCRIM_ATTR } from "@/lib/layout";
import { FONT, gradientText } from "@/lib/style";
import { START_GAME, useSiteNavigate } from "@/navigation/routes";
import { sectionAnchor } from "@/navigation/subMenus";
import { COLOR, GRADIENT, SHADOW } from "@/styles/tokens";

// 바로 아래 구간이 앙암바위 미션을 소개해서, 여기서는 특정 사건보다 게임이 굴러가는 순서를 보여 준다.
// 현장 보상은 아직 열리지 않았다(가입 화면 소개와 같은 사실) — 그래서 그 단계에만 「출시 예정」을 단다.
const STEPS = [
  {
    number: "01",
    title: "지역을 고른다",
    description: "지도에서 전설이 잠든 땅을 고르세요. 첫 무대는 나주 앙암바위입니다.",
    tag: "지금 열림 · 나주",
  },
  {
    number: "02",
    title: "사건을 푼다",
    description: "1인칭으로 현장을 걷고 단서를 모아, 어긋난 기록을 바로잡으세요.",
    tag: "1인칭 3D 추리",
  },
  {
    number: "03",
    title: "현장에서 보상을 연다",
    description: "게임에서 찾아낸 장소를 실제로 찾아가면 숨겨진 보상이 열립니다.",
    isComingSoon: true,
  },
] as const satisfies readonly {
  number: string;
  title: string;
  description: string;
  tag?: string;
  isComingSoon?: boolean;
}[];

/** 한눈에 보는 조건. 한 판 시간은 게임 소개·마무리 구간과 같은 값이다. */
const FACTS = [
  ["1인", "플레이"],
  ["15~25분", "한 판"],
  ["설치 없이", "브라우저"],
] as const;

/** 플레이 방법. 절경 사진 위 왼쪽에 제목·조건·단추, 오른쪽에 세 단계를 세로로 잇는다. 스크롤하면 멈춤 없이 바로 보인다. */
export default function CaseFile() {
  const navigate = useSiteNavigate();
  const scrollToSection = useScrollToSection();

  return (
    <section className="case-file" style={sectionStyle} {...sectionAnchor("case-file")}>
      {/* decoding="async" — 그림 풀기를 주 스레드 밖에서 해 스크롤이 안 끊긴다. */}
      <div className="case-file__window">
        <img
          className="case-file__image"
          src="/case.webp"
          alt="안개 낀 영산강 위로 솟은 앙암바위 절벽"
          loading="lazy"
          decoding="async"
          width="1920"
          height="1085"
        />
      </div>
      {/* 가장자리를 어둡게 해 그림 위에서도 글이 읽히게 한다. */}
      <div className="case-file__shade" aria-hidden="true" />

      <div style={textBlockStyle} {...SCRIM_ATTR}>
        <h2 style={titleStyle}>
          화면 속 사건이,
          <br />
          <span style={titleAccentStyle}>현실의 여행이 된다</span>
        </h2>
        <p style={bodyStyle}>
          전설이 잠든 지역을 고르고, 1인칭으로 사건을 풀고,
          <br />
          마지막엔 그 장소를 직접 찾아갑니다.
        </p>

        <dl style={factRowStyle}>
          {FACTS.map(([value, label], i) => (
            <div key={label} style={{ ...factCellStyle, ...(i > 0 ? factDividerStyle : factFirstCellStyle) }}>
              <dt style={factLabelStyle}>{label}</dt>
              <dd style={factValueStyle}>{value}</dd>
            </div>
          ))}
        </dl>

        <div style={{ display: "flex", gap: "16px" }}>
          <button type="button" className="button" style={filledButtonStyle} onClick={() => navigate(START_GAME)}>
            <span className="button__label">지금 플레이하기</span>
          </button>
          <button type="button" className="button" style={outlineButtonStyle} onClick={() => scrollToSection("angam")}>
            <span className="button__label">첫 사건 보기</span>
          </button>
        </div>
      </div>

      {/* 번호 사이를 세로 줄로 이어 차례대로 넘어가는 흐름으로 읽히게 한다. */}
      <ol style={stepListStyle} {...SCRIM_ATTR}>
        <span style={stepLineStyle} aria-hidden="true" />
        {STEPS.map((step) => (
          <li key={step.number} className="play-step" style={stepRowStyle}>
            <span className="play-step__number" style={stepNumberStyle}>
              {step.number}
            </span>
            <div className="play-step__card" style={stepCardStyle}>
              <div style={stepHeadStyle}>
                <span style={stepTitleStyle}>{step.title}</span>
                {"isComingSoon" in step ? (
                  <ComingSoonChip style={{ fontSize: "14px" }} />
                ) : (
                  <span style={stepTagStyle}>{step.tag}</span>
                )}
              </div>
              <span style={stepDescriptionStyle}>{step.description}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const CASE_FILE_EDGE = "rgba(26,48,95,0.35)";

const sectionStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: "2711px",
  width: "1920px",
  height: "860px",
  overflow: "hidden",
  // 그림 평균색. 그림이 오기 전에도 검은 구멍 대신 안개 낀 회색으로 보인다.
  background: "#5d6163",
  // 구간을 가르는 줄은 그림 위에서 겨우 보일 만큼만 — 진하면 화면을 가둔 틀처럼 보인다.
  borderTop: `1px solid ${CASE_FILE_EDGE}`,
  borderBottom: `1px solid ${CASE_FILE_EDGE}`,
  boxSizing: "border-box",
};

const textBlockStyle: CSSProperties = {
  position: "absolute",
  left: "188px",
  top: "50%",
  transform: "translateY(-50%)",
  width: "760px",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "32px",
  zIndex: 2,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: "76px",
  lineHeight: 1.14,
  letterSpacing: "-0.5px",
  color: "#f5f6fb",
  textShadow: "0 4px 30px rgba(0,0,0,0.45)",
};

const titleAccentStyle: CSSProperties = {
  ...gradientText(GRADIENT.titleFrost),
  // 그라디언트 글자에는 그림자가 글자 위로 비친다
  textShadow: "none",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "22px",
  lineHeight: 1.7,
  color: "#d5dbe7",
  textShadow: "0 2px 16px rgba(0,0,0,0.5)",
};

const factRowStyle: CSSProperties = { display: "flex", margin: 0 };

const factCellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column-reverse",
  gap: "4px",
  padding: "0 36px",
};

const factDividerStyle: CSSProperties = { borderLeft: "1px solid rgba(159,178,234,0.25)" };

// 첫 칸은 제목·본문 왼쪽 줄에 붙인다
const factFirstCellStyle: CSSProperties = { paddingLeft: 0 };

const factValueStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "26px",
  color: COLOR.textBright,
  whiteSpace: "nowrap",
};

const factLabelStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "14px",
  letterSpacing: "1px",
  color: "#8b9bc4",
};

const buttonBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px 40px",
  borderRadius: "100px",
  fontFamily: FONT.mono,
  fontSize: "18px",
  fontWeight: 600,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const filledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  color: COLOR.white,
  border: "none",
  backgroundImage: GRADIENT.pillButton("143.454deg"),
  boxShadow: SHADOW.pillGlow,
};

const outlineButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  fontWeight: 400,
  color: COLOR.accent,
  background: COLOR.glass,
  backdropFilter: "blur(7px)",
  WebkitBackdropFilter: "blur(7px)",
  border: "0.5px solid #eeffee",
};

const STEP_NUMBER_SIZE = 64;

const stepListStyle: CSSProperties = {
  position: "absolute",
  left: "1010px",
  top: "50%",
  transform: "translateY(-50%)",
  width: "720px",
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  zIndex: 2,
};

// 첫 번호의 가운데부터 마지막 번호의 가운데까지 — 번호 원 뒤로 지나간다.
const stepLineStyle: CSSProperties = {
  position: "absolute",
  left: `${STEP_NUMBER_SIZE / 2}px`,
  top: `${STEP_NUMBER_SIZE / 2}px`,
  bottom: `${STEP_NUMBER_SIZE / 2}px`,
  width: "1px",
  background: "linear-gradient(180deg, rgba(159,178,234,0.7) 0%, rgba(111,134,191,0.2) 100%)",
};

const stepRowStyle: CSSProperties = { position: "relative", display: "flex", alignItems: "center", gap: "24px" };

const stepNumberStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: `${STEP_NUMBER_SIZE}px`,
  height: `${STEP_NUMBER_SIZE}px`,
  borderRadius: "50%",
  background: "#0a1430",
  border: "1px solid rgba(111,134,191,0.6)",
  boxShadow: "0 0 24px rgba(79,108,176,0.35)",
  fontFamily: FONT.mono,
  fontSize: "18px",
  letterSpacing: "1px",
  color: "#cdd8f6",
};

const stepCardStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "24px 28px",
  borderRadius: "14px",
  background: "rgba(5,11,26,0.62)",
  border: "1px solid rgba(111,134,191,0.35)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};

const stepHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const stepTitleStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 700,
  fontSize: "26px",
  color: COLOR.textBright,
  whiteSpace: "nowrap",
};

const stepTagStyle: CSSProperties = {
  padding: "4px 12px",
  borderRadius: "999px",
  border: "1px solid rgba(111,134,191,0.45)",
  background: "rgba(5,11,26,0.72)",
  fontFamily: FONT.mono,
  fontSize: "14px",
  color: "#cdd8f6",
  whiteSpace: "nowrap",
};

const stepDescriptionStyle: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: "18px",
  lineHeight: 1.55,
  color: "#b7c1d4",
};
