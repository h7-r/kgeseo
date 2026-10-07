import type { CSSProperties } from "react";

import TabBar from "@/components/TabBar";
import { TERMS_CONTENT, TERMS_HEIGHTS, TERMS_TABS, type TermsTabId } from "@/data/terms";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface TermsTabsProps {
  tab: TermsTabId;
  top: number;
  left?: number;
  width?: number;
  onTabChange: (id: TermsTabId) => void;
}

/** 약관·법적 고지 카드. 인증 화면도 자리와 폭만 바꿔 같은 카드를 쓴다. */
export default function TermsTabs({ tab, top, left = 80, width = 1760, onTabChange }: TermsTabsProps) {
  return (
    <section
      style={{
        ...rootStyle,
        top: `${top}px`,
        left: `${left}px`,
        width: `${width}px`,
        minHeight: `${TERMS_HEIGHTS[tab]}px`,
      }}
    >
      <TabBar
        items={TERMS_TABS}
        activeId={tab}
        onSelect={onTabChange}
        style={tabRowStyle}
        activeTabStyle={activeTabStyle}
        inactiveTabStyle={inactiveTabStyle}
      />

      <div style={{ height: "1px", width: "100%", background: "rgba(26,48,95,0.5)" }} />

      {/* 조문 사이는 넓게, 한 조문 안의 줄은 촘촘하게 — 그래야 조 단위로 읽힌다. */}
      <div style={bodyStyle}>
        {TERMS_CONTENT[tab].map((section, i) => {
          if (section.kind === "title") {
            return (
              <p key={i} style={titleStyle}>
                {section.text}
              </p>
            );
          }
          if (section.kind === "article") {
            return (
              <p key={i} style={articleStyle}>
                {section.text}
              </p>
            );
          }
          return (
            <div key={i} style={paragraphStyle}>
              {section.lines.map((line, j) => (
                <p key={j} style={{ ...lineStyle, marginBottom: j === section.lines.length - 1 ? 0 : "10px" }}>
                  {line}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const rootStyle: CSSProperties = {
  position: "absolute",
  background: "rgba(5,11,26,0.3)",
  border: "1px solid rgba(26,48,95,0.6)",
  borderRadius: "16px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  boxSizing: "border-box",
};

const tabRowStyle: CSSProperties = {
  display: "flex",
  gap: "20px",
  padding: "20px 40px",
  width: "100%",
  boxSizing: "border-box",
  overflow: "hidden",
};

const tabBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "12px 18px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  whiteSpace: "nowrap",
  cursor: "pointer",
  boxSizing: "border-box",
};
const activeTabStyle: CSSProperties = { ...tabBaseStyle, background: COLOR.navy, color: COLOR.white };
const inactiveTabStyle: CSSProperties = {
  ...tabBaseStyle,
  background: "#090f20",
  border: `1px solid ${COLOR.border}`,
  color: COLOR.textMuted,
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  padding: "36px 48px 44px",
  width: "100%",
  boxSizing: "border-box",
  overflow: "hidden",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "22px",
  lineHeight: 1.4,
  color: COLOR.textBright,
  width: "100%",
};

// 조문 제목은 본문보다 밝고 굵게, 위로 한 칸 더 띄운다.
const articleStyle: CSSProperties = {
  margin: 0,
  marginTop: "14px",
  fontFamily: FONT.reading,
  fontWeight: 700,
  fontSize: "17px",
  lineHeight: 1.6,
  color: COLOR.accent,
  letterSpacing: "0.3px",
  width: "100%",
};

// 여러 줄을 내리읽는 글이라 모노가 아니라 읽기 글꼴을 쓴다.
const paragraphStyle: CSSProperties = {
  fontFamily: FONT.reading,
  letterSpacing: "-0.1px",
  fontWeight: 400,
  fontSize: "16px",
  color: COLOR.textMuted,
  width: "100%",
  whiteSpace: "pre-wrap",
  // 한 줄이 너무 길면 눈이 다음 줄을 못 찾는다.
  maxWidth: "1500px",
};

const lineStyle: CSSProperties = {
  margin: 0,
  lineHeight: 1.9,
};
