import type { CSSProperties } from "react";

import { useLineBreaks } from "./useLineBreaks";

/**
 * 두 줄 넘게 넘어가면 문장 · 쉼표 자리에서 끊어 그리는 문단(lineBreak) — 알림 · 자막처럼 통째로 나오는 글에 쓴다.
 * sentenceLines 를 주면 문장마다 줄을 바꾼다(그 줄 수 안일 때만, 미르 11/12).
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
      {shown}
    </p>
  );
}
