import type { CSSProperties } from "react";

import { PRICING } from "@/data/pricing";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface TrialNoticeProps {
  /** 놓이는 자리의 여백 · 글 크기만 덧씌운다. 글은 이 상자의 fontSize 를 따른다. */
  style?: CSSProperties;
}

/** 요금표 · 결제 정보 · 혜택 머리와 구독 · 자세히 보기 창에 붙는 시험운영 안내. 글은 PRICING.trialNotice 한 곳에서 온다. */
export default function TrialNotice({ style }: TrialNoticeProps) {
  const { label, detail } = PRICING.trialNotice;
  return (
    <p style={{ ...noticeStyle, ...style }}>
      <strong style={labelStyle}>{label}</strong>
      <span style={detailStyle}>{detail}</span>
    </p>
  );
}

// 「준비 중」 딱지와 같은 점선 — 아직 열리지 않은 것이라는 표시를 한 가지로 맞춘다.
const noticeStyle: CSSProperties = {
  margin: 0,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  columnGap: "12px",
  rowGap: "4px",
  padding: "10px 16px",
  borderRadius: "12px",
  border: "1px dashed rgba(111,134,191,0.55)",
  background: "rgba(8,22,61,0.55)",
  fontFamily: FONT.mono,
  fontSize: "14px",
  lineHeight: 1.5,
  boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
  fontWeight: 700,
  color: "#9fb4ea",
  whiteSpace: "nowrap",
};

const detailStyle: CSSProperties = { color: COLOR.textMuted };
