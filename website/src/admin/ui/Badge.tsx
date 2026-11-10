import type { ReactNode } from "react";

/** blue = 정상 · 활성 · 좋음, red = 오류 · 경고 · 미답변 · 긴급, gray = 보조. */
export type BadgeTone = "blue" | "red" | "gray";

export default function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`adm-badge adm-badge--${tone}`}>{children}</span>;
}
