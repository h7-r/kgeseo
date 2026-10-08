import { useId, useState, type CSSProperties } from "react";

import chevronDownIcon from "@/assets/images/imgChevronDown.svg";
import chevronRightIcon from "@/assets/images/imgChevronRight2.svg";
import { ALL, FAQ_FILTERS, FAQ_ITEMS } from "@/data/support";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import { CategoryBadge, FilterChips, PanelHeading } from "./PanelParts";
import { emptyStyle, panelStyle, rowCardStyle } from "./styles";

export default function FaqPanel() {
  const [filter, setFilter] = useState<(typeof FAQ_FILTERS)[number]>(ALL);
  // 디자인처럼 첫 항목이 펼쳐진 채로 시작한다.
  const [openIndex, setOpenIndex] = useState(0);
  const idPrefix = useId();

  const filtered = filter === ALL ? FAQ_ITEMS : FAQ_ITEMS.filter((item) => item.category === filter);

  return (
    <>
      <PanelHeading title="자주 묻는 질문" description="궁금한 점을 빠르게 찾아보세요" />
      <FilterChips
        options={FAQ_FILTERS}
        selected={filter}
        onSelect={(value) => {
          setFilter(value);
          setOpenIndex(0);
        }}
      />
      <div style={panelStyle}>
        <div style={faqHeaderStyle}>
          <span style={{ width: "100px" }}>분류</span>
          <span style={{ flex: "1 0 0" }}>질문</span>
          <span>상태</span>
        </div>
        {filtered.length === 0 && (
          <div style={{ ...emptyStyle, padding: "24px 32px" }}>해당 분류의 질문이 없습니다.</div>
        )}
        {filtered.map((item, i) => {
          const isOpen = i === openIndex;
          const answerId = `${idPrefix}-answer-${i}`;
          return (
            <div key={i} className="list-row" style={faqRowStyle}>
              {/* 질문 줄만 단추로 둔다. 줄 전체가 단추면 펼친 답까지 단추 이름에 섞여 읽힌다. */}
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? answerId : undefined}
                style={questionButtonStyle}
                onClick={() => setOpenIndex(isOpen ? -1 : i)}
              >
                <div style={{ width: "100px", flexShrink: 0 }}>
                  <CategoryBadge category={item.category} />
                </div>
                <div
                  style={{
                    flex: "1 0 0",
                    minWidth: 0,
                    fontFamily: FONT.mono,
                    fontSize: "16px",
                    color: COLOR.lightText,
                  }}
                >
                  {item.question}
                </div>
                <img
                  loading="lazy"
                  decoding="async"
                  src={isOpen ? chevronDownIcon : chevronRightIcon}
                  alt=""
                  style={{ width: "16px", height: "16px", display: "block" }}
                />
              </button>
              {isOpen && (
                <>
                  <div style={{ height: "1px", background: COLOR.lightDivider }} />
                  <div id={answerId} role="region" aria-label={item.question} style={answerStyle}>
                    {item.answer || "준비 중인 답변입니다."}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

const faqHeaderStyle: CSSProperties = {
  display: "flex",
  gap: "24px",
  padding: "16px 32px",
  background: COLOR.lightSurface,
  fontFamily: FONT.mono,
  fontWeight: 700,
  fontSize: "16px",
  color: COLOR.blueMid,
};

const faqRowStyle: CSSProperties = {
  ...rowCardStyle,
  flexDirection: "column",
  alignItems: "stretch",
  gap: "12px",
  padding: "20px 32px",
};

const questionButtonStyle: CSSProperties = {
  display: "flex",
  gap: "16px",
  alignItems: "center",
  width: "100%",
  cursor: "pointer",
  // 단추는 브라우저가 word-spacing 을 normal 로 되돌려 모노 글꼴의 좁힌 띄어쓰기가 풀린다.
  wordSpacing: "inherit",
};

const answerStyle: CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: "16px",
  lineHeight: 1.7,
  color: COLOR.lightTextMuted,
};
