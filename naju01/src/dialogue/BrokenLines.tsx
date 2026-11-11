import type { CSSProperties } from "react";

import { useLineBreaks } from "./useLineBreaks";

/** 두 줄 넘게 넘어가면 문장 · 쉼표 자리에서 끊어 그리는 문단(lineBreak) — 알림 · 자막처럼 통째로 나오는 글에 쓴다 */
export function BrokenLines({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  const [ref, shown] = useLineBreaks<HTMLParagraphElement>(text);
  return (
    <p ref={ref} className={className} style={{ ...style, whiteSpace: "pre-line" }}>
      {shown}
    </p>
  );
}
