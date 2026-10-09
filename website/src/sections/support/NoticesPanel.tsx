import { useState } from "react";

import { ALL_CATEGORIES, NOTICE_FILTERS, NOTICES } from "@/data/support";
import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

import Pager from "./Pager";
import CategoryFilter, { CategoryBadge } from "./CategoryFilter";
import PanelHeading from "./PanelHeading";
import { emptyStyle, panelStyle, rowCardStyle } from "./supportStyles";

// 디자인엔 쪽번호가 10쪽까지 있지만 자료는 8건뿐이다. 빈 쪽이 생기지 않게 있는 쪽만 그린다.
const NOTICES_PER_PAGE = 6;

export default function NoticesPanel() {
  const [filter, setFilter] = useState<(typeof NOTICE_FILTERS)[number]>(ALL_CATEGORIES);
  const [page, setPage] = useState(1);

  const filtered = filter === ALL_CATEGORIES ? NOTICES : NOTICES.filter((notice) => notice.category === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / NOTICES_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * NOTICES_PER_PAGE, currentPage * NOTICES_PER_PAGE);
  const goToPage = (n: number) => setPage(Math.min(pageCount, Math.max(1, n)));

  return (
    <>
      <PanelHeading
        title="공지사항"
        description="게임 관련 최신 패치 노트, 정기 점검, 이벤트 공지 및 중요 안내를 신속하게 확인하세요."
      />
      <div style={panelStyle}>
        <div style={{ padding: "0 32px" }}>
          <CategoryFilter
            options={NOTICE_FILTERS}
            selected={filter}
            onSelect={(value) => {
              setFilter(value);
              // 거르면 첫 쪽으로. 3쪽에 머물러 있으면 빈 화면을 본다.
              setPage(1);
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "0 32px" }}>
          {visible.length === 0 && <div style={emptyStyle}>해당 분류의 공지가 없습니다.</div>}
          {visible.map((notice, i) => (
            <div key={i} className="interactive-row" style={rowCardStyle}>
              <div style={{ width: "100px", flexShrink: 0 }}>
                <CategoryBadge category={notice.category} />
              </div>
              <div
                style={{ flex: "1 0 0", minWidth: 0, fontFamily: FONT.mono, fontSize: "16px", color: COLOR.lightText }}
              >
                {notice.title}
              </div>
              <div
                style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.lightTextMuted, whiteSpace: "nowrap" }}
              >
                {notice.date}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Pager page={currentPage} pageCount={pageCount} onChange={goToPage} />
    </>
  );
}
