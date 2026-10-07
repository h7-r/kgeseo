import type { CSSProperties } from "react";

interface LayeredRingsProps {
  /** 자리와 크기(place(...) 결과). */
  style: CSSProperties;
  variant?: "a" | "b";
  className?: string;
}

const perspectiveStyle: CSSProperties = { perspective: "1500px", pointerEvents: "none" };

/**
 * 겹겹의 큰 원. 정원은 돌아도 안 보여서 고리마다 다르게 기울인 타원으로 돌린다 — 서로 앞뒤로 엇갈린다.
 * SVG 두 장(2.5MB)을 받는 대신 CSS 로 그린다.
 */
export default function LayeredRings({ style, variant = "a", className }: LayeredRingsProps) {
  return (
    <div className={className} style={{ ...style, ...perspectiveStyle }} aria-hidden="true">
      <div className={`rings rings--${variant}`}>
        {/* 바깥일수록 얇고 많이 누워 있어 멀리 있어 보인다. */}
        <div className="ring ring--outer" />
        <div className="ring ring--middle" />
        <div className="ring ring--inner" />
      </div>
    </div>
  );
}
