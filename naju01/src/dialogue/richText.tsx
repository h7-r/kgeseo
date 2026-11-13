import { Fragment, type CSSProperties, type ReactNode } from "react";

import { emphasisRuns, type TextRun } from "./emphasis";

/** 굵게 표시(**)한 곳 — 글 상자 기본 굵기(500)보다 확 굵게. 폭 재기(useLineBreaks STRONG_WEIGHT)와 같은 값 */
const STRONG_STYLE: CSSProperties = { fontWeight: 800 };

const plain = (text: string): ReactNode => text;

/** 조각들을 그린다 — 굵은 조각은 <strong>. renderText 로 [E] 같은 키 표시를 따로 그릴 수 있다 */
export function renderRuns(runs: readonly TextRun[], renderText: (text: string) => ReactNode = plain): ReactNode {
  return runs.map((run, index) =>
    run.strong ? (
      <strong key={index} className="naju-em" style={STRONG_STYLE}>
        {renderText(run.text)}
      </strong>
    ) : (
      <Fragment key={index}>{renderText(run.text)}</Fragment>
    ),
  );
}

/** 원고 글(**굵게** 표시 포함)을 그린다 — 짝 없는 별표는 드러내지 않는다 */
export const renderEmphasis = (text: string, renderText?: (text: string) => ReactNode) =>
  renderRuns(emphasisRuns(text), renderText);
