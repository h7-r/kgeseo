import { useEffect, useState, type CSSProperties } from "react";

import Modal from "@/components/Modal";
import { SUPPORT_EMAIL } from "@/data/contact";
import { ALL_CATEGORIES, NOTICE_FILTERS, type NoticeCategory } from "@/data/support";
import { FONT } from "@/lib/style";
import {
  fetchNoticeDetail,
  fetchNotices,
  formatNoticeDate,
  noticeCategoryCode,
  noticeCategoryLabel,
  type NoticeCategoryLabel,
  type PublicNotice,
  type PublicNoticeDetail,
  type PublicNoticePage,
} from "@/services/notices";
import { COLOR } from "@/styles/tokens";

import Pager from "./Pager";
import CategoryFilter, { CategoryBadge } from "./CategoryFilter";
import PanelHeading from "./PanelHeading";
import { emptyStyle, panelStyle, rowCardStyle } from "./supportStyles";

/** 못 불러왔을 때 — 옛 공지로 되돌아가지 않고 안내 + 문의 메일(미르 11/16) */
const LOAD_FAILED = `공지를 불러오지 못했어요. 잠시 후 다시 시도하거나 ${SUPPORT_EMAIL} 로 알려 주세요.`;

type Filter = (typeof NOTICE_FILTERS)[number];
type ListState = { status: "loading" } | { status: "ready"; page: PublicNoticePage } | { status: "error" };

/**
 * 공지사항 — 서버의 공지(공지 API v0.2, 세진 11/16)를 분류별로 6개씩 보여 준다. 고정 공지는 맨 앞에 한 번만 온다.
 * 줄을 누르면 본문을 창으로 — 글자만 보여 주고 HTML 로 해석하지 않는다(공지 · 문의 화면 규칙).
 */
export default function NoticesPanel() {
  const [filter, setFilter] = useState<Filter>(ALL_CATEGORIES);
  const [page, setPage] = useState(1);
  // 받아 둔 결과는 어떤 조건(분류 · 쪽)의 것인지 키를 함께 둔다 — 조건이 바뀌면 그 자리는 「불러오는 중」이다
  const requestKey = `${filter}:${page}`;
  const [loaded, setLoaded] = useState<{ key: string; state: ListState } | null>(null);
  const list: ListState = loaded?.key === requestKey ? loaded.state : { status: "loading" };
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const category = filter === ALL_CATEGORIES ? undefined : noticeCategoryCode(filter as NoticeCategoryLabel);
    fetchNotices({ category, page }, controller.signal)
      .then((result) => setLoaded({ key: requestKey, state: { status: "ready", page: result } }))
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, state: { status: "error" } });
      });
    return () => controller.abort();
  }, [filter, page, requestKey]);

  const pageCount = list.status === "ready" ? Math.max(1, list.page.total_pages) : 1;
  const currentPage = Math.min(page, pageCount);
  const goToPage = (n: number) => setPage(Math.min(pageCount, Math.max(1, n)));

  return (
    <>
      <PanelHeading
        title="공지사항"
        description="패치 노트 · 정기 점검 · 이벤트 소식과 중요한 안내를 한곳에서 확인하세요."
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
          {list.status === "loading" && <div style={emptyStyle}>공지를 불러오는 중입니다…</div>}
          {list.status === "error" && (
            // 실패해도 코드에 고정된 옛 공지로 돌아가지 않는다(미르 11/16) — 안내와 메일만
            <div style={emptyStyle} role="alert">
              {LOAD_FAILED}
            </div>
          )}
          {list.status === "ready" && list.page.items.length === 0 && (
            <div style={emptyStyle}>
              {filter === ALL_CATEGORIES ? "아직 등록된 공지가 없습니다." : "해당 분류의 공지가 없습니다."}
            </div>
          )}
          {list.status === "ready" &&
            list.page.items.map((notice) => <NoticeRow key={notice.id} notice={notice} onOpen={setOpenId} />)}
        </div>
      </div>

      <Pager page={currentPage} pageCount={pageCount} onChange={goToPage} />
      {openId && <NoticeModal key={openId} id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function NoticeRow({ notice, onOpen }: { notice: PublicNotice; onOpen: (id: string) => void }) {
  const label = noticeCategoryLabel(notice.category) as NoticeCategory;
  return (
    <div
      className="interactive-row"
      style={{ ...rowCardStyle, cursor: "pointer" }}
      role="button"
      tabIndex={0}
      aria-label={`${notice.title} 공지 열기`}
      onClick={() => onOpen(notice.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(notice.id);
        }
      }}
    >
      <div style={{ width: "100px", flexShrink: 0 }}>
        <CategoryBadge category={label} />
      </div>
      <div style={{ flex: "1 0 0", minWidth: 0, display: "flex", alignItems: "center", gap: "10px" }}>
        {notice.is_pinned && <span style={pinStyle}>고정</span>}
        <span style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.lightText, minWidth: 0 }}>
          {notice.title}
        </span>
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: "16px", color: COLOR.lightTextMuted, whiteSpace: "nowrap" }}>
        {formatNoticeDate(notice.published_at)}
      </div>
    </div>
  );
}

type DetailState = { status: "loading" } | { status: "ready"; detail: PublicNoticeDetail } | { status: "error" };

/** 본문 창 — 글자만, 줄바꿈 그대로 */
function NoticeModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetchNoticeDetail(id, controller.signal)
      .then((detail) => setState({ status: "ready", detail }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [id]);

  return (
    <Modal open onClose={onClose} title={state.status === "ready" ? state.detail.title : "공지"} width={640}>
      {state.status === "loading" && <p style={bodyTextStyle}>불러오는 중입니다…</p>}
      {state.status === "error" && (
        <p style={bodyTextStyle} role="alert">
          {LOAD_FAILED}
        </p>
      )}
      {state.status === "ready" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <CategoryBadge category={noticeCategoryLabel(state.detail.category) as NoticeCategory} />
            {state.detail.is_pinned && <span style={pinStyle}>고정</span>}
            <span style={{ fontFamily: FONT.mono, fontSize: "14px", color: COLOR.textMuted }}>
              {formatNoticeDate(state.detail.published_at)}
            </span>
          </div>
          <p style={bodyTextStyle}>{state.detail.body}</p>
        </>
      )}
    </Modal>
  );
}

const pinStyle: CSSProperties = {
  flexShrink: 0,
  padding: "2px 8px",
  borderRadius: "999px",
  fontFamily: FONT.mono,
  fontSize: "12px",
  fontWeight: 700,
  color: COLOR.white,
  background: COLOR.navy,
};
// 사이트 공용 창(Modal)은 어두운 바탕이라 밝은 글자로
const bodyTextStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "16px",
  lineHeight: 1.7,
  color: COLOR.textBright,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
