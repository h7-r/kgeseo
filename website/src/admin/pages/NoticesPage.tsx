import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { toAdminError } from "../api/client";
import {
  NOTICE_CATEGORY_LABEL,
  NOTICE_PAGE_SIZE,
  NOTICE_STATUS_LABEL,
  createNotice,
  deleteNotice,
  fetchAdminNotice,
  fetchAdminNoticePage,
  updateNotice,
  type AdminNoticeDetail,
  type AdminNoticeItem,
  type AdminNoticePage,
  type NoticeCategory,
  type NoticeInput,
  type NoticeStatus,
} from "../api/notices";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { formatDateTime, parseServerTime } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import Badge, { type BadgeTone } from "../ui/Badge";
import DataTable from "../ui/DataTable";
import Modal from "../ui/Modal";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";

const FILTERS = [
  { id: "all", label: "전체" },
  { id: "published", label: "게시" },
  { id: "scheduled", label: "예약" },
  { id: "draft", label: "초안" },
] as const;

const STATUS_TONE: Record<NoticeStatus, BadgeTone> = { published: "blue", scheduled: "gray", draft: "gray" };
const CATEGORIES = Object.keys(NOTICE_CATEGORY_LABEL) as NoticeCategory[];

/** 주소의 ?new=1 이 켜지면 작성 창이 열린다 — 머리의 단추와 화면이 이 값 하나로 통한다 */
const NEW_PARAM = "new";
/** 주소의 ?open=<공지 id> — 수정 창(활동 로그의 대상에서 바로 온다) */
const OPEN_PARAM = "open";

/** 머리 오른쪽 「공지 작성」 — 작성 창을 연다 */
export function NoticeWriteButton() {
  const [, setParams] = useSearchParams();
  return (
    <button
      type="button"
      className="adm-button adm-button--primary"
      onClick={() =>
        setParams((params) => {
          const next = new URLSearchParams(params);
          next.set(NEW_PARAM, "1");
          return next;
        })
      }
    >
      공지 작성
    </button>
  );
}

/**
 * 공지사항 — 웹 고객센터 공지의 목록 · 등록 · 수정 · 삭제(공지 API v0.2, 세진 11/16).
 * 상태(초안 · 예약 · 게시)는 서버가 게시 시각으로 정한다. 본문은 글자만 저장하고 HTML 로 해석하지 않는다.
 * 목록 · 상세 조회는 기록하지 않고, 등록 · 수정 · 삭제만 활동 로그에 남는다.
 */
export default function NoticesPage() {
  const [filter, setFilter] = useQueryChoice("status", FILTERS, "all");
  const [params, setParams] = useSearchParams();
  const [reload, setReload] = useState(0);
  const key = `${filter}:${reload}`;
  const [resource, retry] = useAdminResource(`notices:${key}`, (signal) =>
    fetchAdminNoticePage(filter === "all" ? undefined : filter, 0, signal),
  );
  const [more, setMore] = useState<{ key: string; items: AdminNoticeItem[]; next: number | null } | null>(null);
  const openId = params.get(OPEN_PARAM);
  const isCreating = params.get(NEW_PARAM) === "1";
  const setOpenId = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(OPEN_PARAM, id);
        return next;
      },
      { replace: true },
    );

  const refresh = () => {
    setMore(null);
    setReload((count) => count + 1);
  };
  const closeEditor = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(OPEN_PARAM);
        next.delete(NEW_PARAM);
        return next;
      },
      { replace: true },
    );
  const loadMore = (next: number) =>
    fetchAdminNoticePage(filter === "all" ? undefined : filter, next).then((page) =>
      setMore((current) => ({
        key,
        items: [...(current?.key === key ? current.items : []), ...page.items],
        next: page.next_offset,
      })),
    );

  return (
    <>
      <ResourceView resource={resource} retry={retry} loadingText="공지를 불러오는 중…">
        {(page: AdminNoticePage) => {
          const rows = more?.key === key ? [...page.items, ...more.items] : page.items;
          const next = more?.key === key ? more.next : page.next_offset;
          return (
            <Panel
              title="공지 목록"
              meta="최근 작성순 · 제목을 누르면 수정"
              actions={<PillTabs label="상태" items={FILTERS} activeId={filter} onSelect={setFilter} />}
            >
              <DataTable
                caption="공지 목록"
                rows={rows}
                rowKey={(row) => row.id}
                emptyText={
                  filter === "all"
                    ? "아직 등록한 공지가 없습니다. 오른쪽 위 「공지 작성」으로 시작하세요."
                    : `${FILTERS.find((item) => item.id === filter)?.label} 상태의 공지가 없습니다.`
                }
                columns={[
                  {
                    key: "title",
                    header: "제목",
                    truncate: (row) => row.title,
                    render: (row) => (
                      <button
                        type="button"
                        className="adm-button adm-button--ghost adm-button--small"
                        onClick={() => setOpenId(row.id)}
                      >
                        {row.title}
                      </button>
                    ),
                  },
                  {
                    key: "category",
                    header: "분류",
                    width: "96px",
                    render: (row) => <Badge tone="gray">{NOTICE_CATEGORY_LABEL[row.category]}</Badge>,
                  },
                  {
                    key: "status",
                    header: "상태",
                    width: "132px",
                    render: (row) => (
                      <>
                        <Badge tone={STATUS_TONE[row.status]}>{NOTICE_STATUS_LABEL[row.status]}</Badge>
                        {row.is_pinned && <Badge tone="red">고정</Badge>}
                      </>
                    ),
                  },
                  {
                    key: "published",
                    header: "게시 시각",
                    mono: true,
                    width: "168px",
                    render: (row) =>
                      row.published_at ? formatDateTime(row.published_at) : <span className="adm-muted">—</span>,
                  },
                  {
                    key: "author",
                    header: "작성자",
                    width: "120px",
                    truncate: (row) => row.created_by?.nickname ?? "",
                    render: (row) => row.created_by?.nickname ?? <span className="adm-muted">—</span>,
                  },
                  {
                    key: "updated",
                    header: "마지막 수정",
                    mono: true,
                    width: "168px",
                    render: (row) => formatDateTime(row.updated_at),
                  },
                ]}
              />
              {next !== null && (
                <button type="button" className="adm-button adm-button--block" onClick={() => loadMore(next)}>
                  더 보기 ({NOTICE_PAGE_SIZE}건씩)
                </button>
              )}
            </Panel>
          );
        }}
      </ResourceView>
      {isCreating && <NoticeEditor id={null} onClose={closeEditor} onChanged={refresh} />}
      {openId && !isCreating && <NoticeEditor id={openId} onClose={closeEditor} onChanged={refresh} />}
    </>
  );
}

// ── 작성 · 수정 창 ──

type PublishMode = "now" | "schedule" | "draft";

interface Draft {
  title: string;
  body: string;
  category: NoticeCategory;
  isPinned: boolean;
  mode: PublishMode;
  /** datetime-local 값(브라우저 지역 시각) — 예약일 때만 쓴다 */
  scheduledAt: string;
}

const EMPTY_DRAFT: Draft = { title: "", body: "", category: "info", isPinned: false, mode: "now", scheduledAt: "" };

/** 서버 시각(UTC, 시간대 표기 없음) → datetime-local 입력값(브라우저 지역 시각, 분까지) */
function toLocalInput(serverTime: string): string {
  const time = parseServerTime(serverTime);
  if (time === undefined) return "";
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function draftOf(detail: AdminNoticeDetail): Draft {
  return {
    title: detail.title,
    body: detail.body,
    category: detail.category,
    isPinned: detail.is_pinned,
    // 이미 게시 · 예약된 글은 그 시각을 그대로 두고 고칠 수 있게 「시각 지정」 칸에 올린다
    mode: detail.published_at ? "schedule" : "draft",
    scheduledAt: detail.published_at ? toLocalInput(detail.published_at) : "",
  };
}

/** 입력을 요청 본문으로. 문제가 있으면 안내 글을 돌려준다. 게시 시각은 시간대가 든 UTC(Z)로 보낸다 */
function toInput(draft: Draft): { input: NoticeInput } | { error: string } {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title || title.length > 200) return { error: "제목은 1~200자로 써 주세요." };
  if (!body || body.length > 20000) return { error: "본문은 1~20,000자로 써 주세요." };
  let published_at: string | null = null;
  if (draft.mode === "now") published_at = new Date().toISOString();
  if (draft.mode === "schedule") {
    const time = new Date(draft.scheduledAt);
    if (!draft.scheduledAt || Number.isNaN(time.getTime())) return { error: "게시 시각을 골라 주세요." };
    published_at = time.toISOString();
  }
  return { input: { title, body, category: draft.category, is_pinned: draft.isPinned, published_at } };
}

/** 새 글(id null) 또는 기존 글 수정 · 삭제 */
function NoticeEditor({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [resource, retry] = useAdminResource(`notice:${id ?? "new"}`, (signal) =>
    id ? fetchAdminNotice(id, signal) : Promise.resolve(null),
  );
  return (
    <Modal
      title={id ? "공지 수정" : "공지 작성"}
      meta="등록 · 수정 · 삭제는 활동 로그에 남습니다. 본문은 글자만 저장됩니다(HTML 해석 안 함)."
      onClose={onClose}
      wide
    >
      <ResourceView resource={resource} retry={retry} loadingText="공지를 불러오는 중…" notFoundText="없는 공지입니다.">
        {(detail: AdminNoticeDetail | null) => (
          // 다른 글을 열면(키가 바뀌면) 폼을 새로 만들어 그 글의 값으로 시작한다
          <NoticeForm key={detail?.id ?? "new"} detail={detail} onClose={onClose} onChanged={onChanged} />
        )}
      </ResourceView>
    </Modal>
  );
}

function NoticeForm({
  detail,
  onClose,
  onChanged,
}: {
  detail: AdminNoticeDetail | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (detail ? draftOf(detail) : EMPTY_DRAFT));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      await work();
      onChanged();
      onClose();
    } catch (error) {
      const kind = toAdminError(error).kind;
      setNotice(
        kind === "invalidQuery"
          ? "입력값을 다시 확인해 주세요(제목 1~200자 · 본문 1~20,000자 · 게시 시각)."
          : kind === "notFound"
            ? "이미 지워진 공지입니다."
            : "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const parsed = toInput(draft);
    if ("error" in parsed) {
      setNotice(parsed.error);
      return;
    }
    const { input } = parsed;
    return detail ? run(() => updateNotice(detail.id, input)) : run(() => createNotice(input));
  };

  return (
    <div className="adm-grid adm-grid--two">
      <Panel title="내용">
        <label className="adm-field">
          <span>제목(1~200자)</span>
          <input
            className="adm-input"
            maxLength={200}
            value={draft.title}
            disabled={busy}
            onChange={(event) => set("title", event.target.value)}
          />
        </label>
        <label className="adm-field">
          <span>본문(1~20,000자) — 줄바꿈은 그대로 보이고, 링크 · HTML 은 글자로만 보입니다</span>
          <textarea
            className="adm-input"
            rows={14}
            maxLength={20000}
            value={draft.body}
            disabled={busy}
            onChange={(event) => set("body", event.target.value)}
          />
        </label>
      </Panel>
      <Panel
        title="게시"
        meta={
          detail
            ? `${NOTICE_STATUS_LABEL[detail.status]} · 마지막 수정 ${formatDateTime(detail.updated_at)}`
            : "새 공지"
        }
      >
        <label className="adm-field">
          <span>분류</span>
          <select
            className="adm-input"
            value={draft.category}
            disabled={busy}
            onChange={(event) => set("category", event.target.value as NoticeCategory)}
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {NOTICE_CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="adm-field" disabled={busy}>
          <span>게시 시각</span>
          <label className="adm-check-row">
            <input type="radio" name="mode" checked={draft.mode === "now"} onChange={() => set("mode", "now")} />
            지금 게시
          </label>
          <label className="adm-check-row">
            <input
              type="radio"
              name="mode"
              checked={draft.mode === "schedule"}
              onChange={() => set("mode", "schedule")}
            />
            시각 지정(미래면 예약 · 과거면 바로 게시)
          </label>
          {draft.mode === "schedule" && (
            <input
              className="adm-input"
              type="datetime-local"
              value={draft.scheduledAt}
              aria-label="게시 시각"
              onChange={(event) => set("scheduledAt", event.target.value)}
            />
          )}
          <label className="adm-check-row">
            <input type="radio" name="mode" checked={draft.mode === "draft"} onChange={() => set("mode", "draft")} />
            초안으로 두기(웹에 안 보임)
          </label>
        </fieldset>
        <label className="adm-check-row">
          <input
            type="checkbox"
            checked={draft.isPinned}
            disabled={busy}
            onChange={(event) => set("isPinned", event.target.checked)}
          />
          고정 — 웹 공지 목록 맨 앞에 보입니다
        </label>
        <div className="adm-input-group">
          <button type="button" className="adm-button adm-button--primary" disabled={busy} onClick={() => void save()}>
            {detail ? "저장" : "등록"}
          </button>
          <button type="button" className="adm-button" disabled={busy} onClick={onClose}>
            닫기
          </button>
          {detail &&
            (isConfirmingDelete ? (
              <button
                type="button"
                className="adm-button"
                disabled={busy}
                onClick={() => run(() => deleteNotice(detail.id))}
              >
                정말 삭제(되돌릴 수 없음)
              </button>
            ) : (
              <button type="button" className="adm-button" disabled={busy} onClick={() => setIsConfirmingDelete(true)}>
                삭제
              </button>
            ))}
        </div>
        {notice && (
          <p className="adm-muted" role="status">
            {notice}
          </p>
        )}
      </Panel>
    </div>
  );
}
