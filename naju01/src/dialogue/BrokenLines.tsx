import type { CSSProperties } from "react";

import { renderEmphasis } from "./richText";
import { useLineBreaks } from "./useLineBreaks";

/**
 * 두 줄 넘게 넘어가면 문장 · 쉼표 자리에서 끊어 그리는 문단(lineBreak) — 알림 · 자막처럼 통째로 나오는 글에 쓴다.
 * sentenceLines 를 주면 한 줄에 들어가는 문장끼리 묶고 안 들어가는 문장은 새 줄에 둔다(그 줄 수 안일 때만, 미르 11/12).
 * 굵게 표시(**)는 <strong> 으로 그린다.
 */
export function BrokenLines({
  text,
  className,
  style,
  sentenceLines,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
  sentenceLines?: number;
}) {
  const [ref, shown] = useLineBreaks<HTMLParagraphElement>(text, { sentenceLines });
  return (
    <p ref={ref} className={className} style={{ ...style, whiteSpace: "pre-line" }}>
      {renderEmphasis(shown)}
    </p>
  );
}
