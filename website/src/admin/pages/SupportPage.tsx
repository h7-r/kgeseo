import { useState, type ReactNode } from "react";

import { toAdminError } from "../api/client";
import {
  CATEGORY_LABEL,
  INQUIRY_PAGE_SIZE,
  STATUS_LABEL,
  fetchInquiry,
  fetchInquiryPage,
  replyInquiry,
  updateInquiry,
  type InquiryDetail,
  type InquiryFilter,
  type InquiryListItem,
  type InquiryPage,
  type InquiryPriority,
  type InquiryStatus,
} from "../api/inquiries";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { formatDateTime, formatNumber } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import Badge, { type BadgeTone } from "../ui/Badge";
import DataTable from "../ui/DataTable";
import Modal from "../ui/Modal";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";

const FILTERS = [
  { id: "all", label: "전체" },
  { id: "open", label: "미답변" },
  { id: "answered", label: "답변 완료" },
  { id: "closed", label: "종료" },
  { id: "urgent", label: "긴급" },
] as const satisfies readonly { id: InquiryFilter; label: string }[];

const STATUS_TONE: Record<InquiryStatus, BadgeTone> = { open: "red", answered: "blue", closed: "gray" };

type Run = (work: () => Promise<InquiryDetail>, done: string) => Promise<void>;

/**
 * CS 관리 — 1:1 문의 목록 · 상세 · 답변 · 상태(관리자 API v0.3 P3-1).
 * 목록을 열 때마다 서버가 「문의 목록 조회」를, 상세를 열면 「문의 열람」을 남긴다. 이메일은 목록에선 서버가 가리고 상세에서만 전체다.
 */
export default function SupportPage() {
  const [filter, setFilter] = useQueryChoice("filter", FILTERS, "all");
  const [reload, setReload] = useState(0);
  const key = `${filter}:${reload}`;
  const [resource, retry] = useAdminResource(`inquiries:${key}`, (signal) => fetchInquiryPage(filter, 0, signal));
  // 「더 보기」로 이어 받은 쪽들 — 필터 · 새로고침이 바뀌면 버린다
  const [more, setMore] = useState<{ key: string; items: InquiryListItem[]; next: number | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = () => {
    setMore(null);
    setReload((count) => count + 1);
  };

  const loadMore = (next: number) =>
    fetchInquiryPage(filter, next).then((page) =>
      setMore((current) => ({
        key,
        items: [...(current?.key === key ? current.items : []), ...page.items],
        next: page.next_offset,
      })),
    );

  return (
    <>
      <ResourceView resource={resource} retry={retry} loadingText="문의를 불러오는 중…">
        {(page: InquiryPage) => {
          const rows = more?.key === key ? [...page.items, ...more.items] : page.items;
          const next = more?.key === key ? more.next : page.next_offset;
          return (
            <>
              <div className="adm-grid adm-grid--four">
                <StatCard label="전체 문의" value={formatNumber(page.stats.total)} unit="건" caption="누적" />
                <StatCard
                  label="미답변"
                  value={formatNumber(page.stats.open)}
                  unit="건"
                  caption="답변 대기"
                  isAlert={page.stats.open > 0}
                />
                <StatCard
                  label="오늘 접수"
                  value={formatNumber(page.stats.today)}
                  unit="건"
                  caption="오늘 0시부터(KST)"
                />
                <StatCard
                  label="평균 첫 답변"
                  value={page.stats.avg_first_reply_hours === null ? null : page.stats.avg_first_reply_hours.toFixed(1)}
                  pendingText="아직 답변한 문의가 없습니다"
                  unit="시간"
                  caption="답변한 문의의 접수→첫 답변"
                />
              </div>
              <Panel
                title="문의 목록"
                meta="최신순 · 제목을 누르면 상세 · 답변"
                actions={<PillTabs label="문의 상태" items={FILTERS} activeId={filter} onSelect={setFilter} />}
              >
                <DataTable
                  caption="문의 목록"
                  rows={rows}
                  rowKey={(row) => row.id}
                  emptyText="이 조건의 문의가 없습니다."
                  columns={[
                    { key: "number", header: "접수 번호", mono: true, width: "176px", render: (row) => row.number },
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
                      key: "who",
                      header: "접수자",
                      width: "200px",
                      truncate: (row) => row.nickname ?? row.email,
                      render: (row) =>
                        row.nickname ? row.nickname : <span className="adm-muted">비회원 · {row.email}</span>,
                    },
                    { key: "category", header: "유형", width: "96px", render: (row) => CATEGORY_LABEL[row.category] },
                    {
                      key: "status",
                      header: "상태",
                      width: "96px",
                      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>,
                    },
                    {
                      key: "priority",
                      header: "우선순위",
                      width: "88px",
                      render: (row) => (row.priority === "urgent" ? <Badge tone="red">긴급</Badge> : "보통"),
                    },
                    {
                      key: "replies",
                      header: "답변",
                      width: "64px",
                      align: "end",
                      render: (row) => formatNumber(row.reply_count),
                    },
                    {
                      key: "received",
                      header: "접수 시각",
                      mono: true,
                      width: "168px",
                      render: (row) => formatDateTime(row.created_at),
                    },
                  ]}
                />
                {next !== null && (
                  <button type="button" className="adm-button adm-button--block" onClick={() => loadMore(next)}>
                    더 보기 ({INQUIRY_PAGE_SIZE}건씩)
                  </button>
                )}
              </Panel>
            </>
          );
        }}
      </ResourceView>
      {openId && <InquiryModal id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  );
}

/** 상세 창 — 본문 · 전체 이메일 · IP 앞 두 자리 · 답변 쓰기 · 상태 · 우선순위 */
function InquiryModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const [resource, retry] = useAdminResource(`inquiry:${id}:${version}`, (signal) => fetchInquiry(id, signal));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const run: Run = async (work, done) => {
    setBusy(true);
    setNotice("");
    try {
      await work();
      setNotice(done);
      setVersion((count) => count + 1);
      onChanged();
    } catch (error) {
      const kind = toAdminError(error).kind;
      setNotice(
        kind === "conflict"
          ? "종료된 문의에는 답할 수 없습니다. 상태를 먼저 바꿔 주세요."
          : kind === "invalidQuery"
            ? "입력값을 다시 확인해 주세요(답변 1~4000자)."
            : "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="문의 상세" meta="여기서 본 것은 활동 로그에 「문의 열람」으로 남습니다" onClose={onClose} wide>
      <ResourceView resource={resource} retry={retry} loadingText="문의를 불러오는 중…" notFoundText="없는 문의입니다.">
        {(detail: InquiryDetail) => (
          <div className="adm-grid adm-grid--two">
            <Panel title={detail.title} meta={detail.number}>
              <dl className="adm-fields">
                <Row label="상태">
                  <Badge tone={STATUS_TONE[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
                  {detail.priority === "urgent" && <Badge tone="red">긴급</Badge>}
                </Row>
                <Row label="유형">{CATEGORY_LABEL[detail.category]}</Row>
                <Row label="접수자">
                  {detail.nickname ? (
                    detail.nickname
                  ) : (
                    <span className="adm-muted">비회원 — 답변은 아래 이메일로 따로 보내야 합니다</span>
                  )}
                </Row>
                <Row label="답변 받을 이메일">
                  <span className="is-mono">{detail.email}</span>
                </Row>
                <Row label="접수 IP">
                  <span className="is-mono">{detail.client_ip_display ?? "—"}</span>
                </Row>
                <Row label="접수 시각">{formatDateTime(detail.created_at)}</Row>
                <Row label="첫 답변">{detail.answered_at ? formatDateTime(detail.answered_at) : "—"}</Row>
              </dl>
              <p className="adm-audit-note" style={{ whiteSpace: "pre-wrap" }}>
                {detail.body}
              </p>
            </Panel>
            <Panel title="답변" meta={`${formatNumber(detail.replies.length)}건`}>
              {detail.replies.length === 0 ? (
                <p className="adm-muted">아직 답변이 없습니다.</p>
              ) : (
                <ul className="adm-facts">
                  {detail.replies.map((reply) => (
                    <li key={reply.id}>
                      <span className="adm-muted">
                        {reply.admin_nickname ?? "관리자(삭제됨)"} · {formatDateTime(reply.created_at)}
                      </span>
                      <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{reply.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <label className="adm-field">
                <span>새 답변 — 회원이면 마이페이지 「내 문의」에 바로 보입니다. 글자만 저장됩니다.</span>
                <textarea
                  className="adm-input"
                  rows={6}
                  maxLength={4000}
                  value={draft}
                  disabled={busy || detail.status === "closed"}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    detail.status === "closed" ? "종료된 문의입니다. 상태를 바꾸면 답할 수 있습니다." : "답변 내용"
                  }
                />
              </label>
              <div className="adm-input-group">
                <button
                  type="button"
                  className="adm-button adm-button--primary"
                  disabled={busy || detail.status === "closed" || !draft.trim()}
                  onClick={() =>
                    run(() => replyInquiry(detail.id, draft.trim()), "답변을 등록했습니다.").then(() => setDraft(""))
                  }
                >
                  답변 등록
                </button>
                <StatusButtons detail={detail} busy={busy} run={run} />
              </div>
              {notice && (
                <p className="adm-muted" role="status">
                  {notice}
                </p>
              )}
            </Panel>
          </div>
        )}
      </ResourceView>
    </Modal>
  );
}

function StatusButtons({ detail, busy, run }: { detail: InquiryDetail; busy: boolean; run: Run }) {
  const set = (patch: { status?: InquiryStatus; priority?: InquiryPriority }, done: string) =>
    run(() => updateInquiry(detail.id, patch), done);
  return (
    <>
      {detail.status !== "closed" ? (
        <button
          type="button"
          className="adm-button"
          disabled={busy}
          onClick={() => set({ status: "closed" }, "종료했습니다.")}
        >
          종료
        </button>
      ) : (
        <button
          type="button"
          className="adm-button"
          disabled={busy}
          onClick={() => set({ status: "open" }, "다시 열었습니다.")}
        >
          다시 열기
        </button>
      )}
      {detail.priority === "urgent" ? (
        <button
          type="button"
          className="adm-button"
          disabled={busy}
          onClick={() => set({ priority: "normal" }, "보통으로 바꿨습니다.")}
        >
          긴급 해제
        </button>
      ) : (
        <button
          type="button"
          className="adm-button"
          disabled={busy}
          onClick={() => set({ priority: "urgent" }, "긴급으로 표시했습니다.")}
        >
          긴급 표시
        </button>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="adm-field-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
