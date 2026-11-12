import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";

import {
  AUDIT_PAGE_SIZE,
  fetchAuditLogs,
  type AuditActor,
  type AuditLogEntry,
  type AuditLogPage,
} from "../api/auditLogs";
import { toAdminError, type AdminApiError } from "../api/client";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import {
  AUDIT_ACTION_FILTERS,
  AUDIT_PERIODS,
  auditActionLabel,
  kstPeriod,
  type AuditActionFilter,
} from "../lib/auditLog";
import { formatDateTime, formatNumber } from "../lib/format";
import { appendUnique } from "../lib/paging";
import { useQueryChoice } from "../lib/useQueryChoice";
import { ADMIN_PATHS, adminLoginPath } from "../paths";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import PillTabs from "../ui/PillTabs";

const logIdOf = (log: AuditLogEntry) => String(log.id);

/** 관리자 감사 기록(admin_audit_logs). 서버에 남는 다섯 칸과 닉네임만 보인다 — 이메일 · IP · 브라우저 정보는 기록에 없다. */
export default function ActivityLogPage() {
  const [period, setPeriod] = useQueryChoice("period", AUDIT_PERIODS, "30");
  const [action, setAction] = useQueryChoice("action", AUDIT_ACTION_FILTERS, "all");

  return (
    <>
      <div className="adm-filters">
        <div className="adm-filters__group">
          <span className="adm-filters__label">기간</span>
          <PillTabs label="기간" items={AUDIT_PERIODS} activeId={period} onSelect={setPeriod} />
        </div>
        <div className="adm-filters__group">
          <span className="adm-filters__label">한 일</span>
          <PillTabs label="한 일" items={AUDIT_ACTION_FILTERS} activeId={action} onSelect={setAction} />
        </div>
      </div>
      <AuditLogTable key={`${period}:${action}`} days={Number(period)} action={action} />
    </>
  );
}

function AuditLogTable({ days, action }: { days: number; action: AuditActionFilter }) {
  const location = useLocation();
  // 기간은 화면을 연 때로 고정한다 — 「더 보기」 사이에 날짜가 넘어가도 같은 조건으로 이어 받는다
  const [query] = useState(() => ({ ...kstPeriod(days, Date.now()), action: action === "all" ? undefined : action }));
  const [resource, retry] = useAdminResource(`audit:${query.from}:${query.to}:${action}`, (signal) =>
    fetchAuditLogs(query, signal),
  );
  const [extra, setExtra] = useState<AuditLogPage | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<AdminApiError | null>(null);

  if (moreError?.kind === "unauthenticated") {
    return <Navigate to={adminLoginPath(location.pathname + location.search)} replace />;
  }

  return (
    <ResourceView resource={resource} retry={retry} loadingText="활동 로그를 불러오고 있습니다">
      {(first) => {
        const logs = extra ? appendUnique(first.logs, extra.logs, logIdOf) : first.logs;
        const nextOffset = extra ? extra.next_offset : first.next_offset;

        const loadMore = async () => {
          if (nextOffset === null) return;
          setIsLoadingMore(true);
          setMoreError(null);
          try {
            const page = await fetchAuditLogs({ ...query, offset: nextOffset });
            setExtra({ logs: appendUnique(extra?.logs ?? [], page.logs, logIdOf), next_offset: page.next_offset });
          } catch (error) {
            setMoreError(toAdminError(error));
          } finally {
            setIsLoadingMore(false);
          }
        };

        return (
          <section className="adm-panel adm-panel--flush" aria-label="활동 로그">
            <p className="adm-audit-note">
              {query.from} ~ {query.to} 한국 시각. 이 화면을 열 때마다 「활동 로그 조회」 한 줄이 남고, 방금 연 기록은
              다음에 열 때 보입니다. IP · 브라우저 정보는 아직 기록하지 않습니다.
            </p>
            <DataTable
              caption="활동 로그"
              rows={logs}
              rowKey={logIdOf}
              emptyText="이 기간 · 종류의 기록이 없습니다."
              columns={[
                {
                  key: "at",
                  header: "시각",
                  mono: true,
                  width: "168px",
                  render: (log) => formatDateTime(log.created_at),
                },
                { key: "admin", header: "관리자", width: "22%", render: (log) => <Actor actor={log.admin} /> },
                {
                  key: "action",
                  header: "한 일",
                  render: (log) => (
                    <Badge tone={log.action === "read_user" ? "blue" : "gray"}>{auditActionLabel(log.action)}</Badge>
                  ),
                },
                {
                  key: "target",
                  header: "대상 회원",
                  width: "22%",
                  render: (log) =>
                    log.target ? <Actor actor={log.target} link /> : <span className="adm-muted">—</span>,
                },
                { key: "id", header: "기록 번호", mono: true, align: "end", width: "112px", render: (log) => log.id },
              ]}
            />
            <footer className="adm-table-foot">
              <span className="adm-table-foot__count">
                {formatNumber(logs.length)}건 표시{nextOffset === null ? " · 마지막까지 모두" : ""}
              </span>
              {moreError && (
                <span className="adm-field__error" role="alert">
                  더 불러오지 못했습니다. 다시 눌러 주세요.
                </span>
              )}
              {nextOffset !== null && (
                <button
                  type="button"
                  className="adm-button adm-button--ghost"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "불러오는 중…" : `${AUDIT_PAGE_SIZE}건 더 보기`}
                </button>
              )}
            </footer>
          </section>
        );
      }}
    </ResourceView>
  );
}

/** 닉네임. 계정이 사라졌으면 id 앞부분만 보인다(감사 기록에는 외래 키가 없어 줄은 남는다). */
function Actor({ actor, link }: { actor: AuditActor; link?: boolean }) {
  if (actor.nickname === null) {
    return (
      <span className="adm-muted" title={actor.user_id}>
        사라진 계정 · {actor.user_id.slice(0, 8)}
      </span>
    );
  }
  if (!link) return <b>{actor.nickname}</b>;
  return <Link to={ADMIN_PATHS.userDetail(actor.user_id)}>{actor.nickname}</Link>;
}
