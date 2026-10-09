import type { CSSProperties } from "react";

import { activePageStyle, inactivePageStyle, pagerArrowStyle } from "@/components/pagerStyles";
import { COLOR } from "@/styles/tokens";

interface PagerProps {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}

/** 게임 소개 쪽번호와 같은 모양. 첫·끝 쪽에서는 화살표를 끈다. */
export default function Pager({ page, pageCount, onChange }: PagerProps) {
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  return (
    <div style={pagerStyle}>
      <button
        type="button"
        className="pager__arrow"
        style={{ ...pagerArrowStyle, ...(hasPrevious ? null : pagerDisabledStyle) }}
        disabled={!hasPrevious}
        onClick={() => onChange(page - 1)}
        aria-label="이전 쪽"
      >
        ‹
      </button>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={n === page ? "pager__page is-active" : "pager__page"}
          style={n === page ? activePageStyle : whitePageStyle}
          onClick={() => onChange(n)}
          aria-label={`${n}쪽`}
          aria-current={n === page ? "page" : undefined}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className="pager__arrow"
        style={{ ...pagerArrowStyle, ...(hasNext ? null : pagerDisabledStyle) }}
        disabled={!hasNext}
        onClick={() => onChange(page + 1)}
        aria-label="다음 쪽"
      >
        ›
      </button>
    </div>
  );
}

const pagerStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  paddingTop: "32px",
  paddingBottom: "16px",
};
// 첫·끝 쪽에선 갈 곳이 없다.
const pagerDisabledStyle: CSSProperties = { opacity: 0.4, cursor: "default", pointerEvents: "none" };
// 인라인 흰 바탕이 .pager__page:active 의 옅은 물듦을 덮는다. 게임 소개 쪽번호와 다른 점이다.
const whitePageStyle: CSSProperties = { ...inactivePageStyle, background: COLOR.white };
