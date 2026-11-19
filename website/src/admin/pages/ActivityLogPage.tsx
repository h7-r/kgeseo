import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";

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
  AUDIT_MAX_DAYS,
  AUDIT_PERIODS,
  auditActionLabel,
  auditTargetLabel,
  kstPeriod,
} from "../lib/auditLog";
import { isIsoDate, validateRange, type DateRange } from "../lib/dateRange";
import { formatDateTime, formatNumber } from "../lib/format";
import { appendUnique } from "../lib/paging";
import { useQueryChoice } from "../lib/useQueryChoice";
import { ADMIN_PATHS, adminLoginPath } from "../paths";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import DateRangePicker from "../ui/DateRangePicker";
import PillTabs from "../ui/PillTabs";
import SearchField from "../ui/SearchField";

const logIdOf = (log: AuditLogEntry) => String(log.id);

const PERIODS = [...AUDIT_PERIODS, { id: "custom", label: "직접 고르기" }] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

/** 주소의 ?from= · ?to= 로 고른 기간. 둘 다 날짜이고 규칙에 맞을 때만 쓴다 */
function readCustomRange(params: URLSearchParams): DateRange | null {
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  return validateRange({ from, to }, AUDIT_MAX_DAYS) ? null : { from, to };
}

/**
 * 관리자 감사 기록(admin_audit_logs). 이메일 · IP 원문은 기록에 없다 — IP 는 서버가 앞 두 자리만 남긴다(감사 기록 확장 11/16).
 * 기간은 빠른 탭 또는 달력(직접 고르기), 한 일은 탭, 찾기는 받은 기록 안에서 닉네임 · id 로 거른다(서버에 검색어를 보내지 않는다).
 */
export default function ActivityLogPage() {
  const [period, setPeriod] = useQueryChoice<PeriodId>("period", PERIODS, "30");
  const [action, setAction] = useQueryChoice("action", AUDIT_ACTION_FILTERS, "all");
  const [params, setParams] = useSearchParams();
  const custom = readCustomRange(params);
  const query = params.get("find") ?? "";
  // 「오늘」은 화면을 연 때로 고정 — 그려질 때마다 시계를 읽으면 자정 근처에 조건이 흔들린다
  const [openedAt] = useState(() => Date.now());

  const applyRange = (range: DateRange) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.set("period", "custom");
        updated.set("from", range.from);
        updated.set("to", range.to);
        return updated;
      },
      { replace: true },
    );
  const applyFind = (value: string) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        if (value) updated.set("find", value);
        else updated.delete("find");
        return updated;
      },
      { replace: true },
    );

  // 「직접 고르기」인데 주소에 기간이 없으면 최근 30일을 달력 시작값으로
  const range: DateRange =
    period === "custom" ? (custom ?? kstPeriod(30, openedAt)) : kstPeriod(Number(period), openedAt);

  return (
    <>
      <div className="adm-filters">
        <div className="adm-filters__group">
          <span className="adm-filters__label">기간</span>
          <PillTabs label="기간" items={PERIODS} activeId={period} onSelect={setPeriod} />
          {period === "custom" && <DateRangePicker value={range} maxDays={AUDIT_MAX_DAYS} onApply={applyRange} />}
        </div>
        <div className="adm-filters__group">
          <span className="adm-filters__label">한 일</span>
          <PillTabs label="한 일" items={AUDIT_ACTION_FILTERS} activeId={action} onSelect={setAction} />
        </div>
      </div>
      <SearchField
        key={`find:${query}`}
        label="기록 찾기"
        placeholder="관리자 · 대상 닉네임 또는 id 앞부분"
        initial={query}
        onSearch={applyFind}
        help="받아 둔 기록 안에서 거릅니다. 검색어는 서버로 가지 않습니다. 더 오래된 기록은 「더 보기」로 먼저 받으세요."
      />
      <AuditLogTable key={`${range.from}:${range.to}:${action}`} range={range} action={action} find={query} />
    </>
  );
}

function matches(log: AuditLogEntry, find: string): boolean {
  const term = find.trim().toLowerCase();
  if (!term) return true;
  const actors = [log.admin, log.target].filter((actor): actor is AuditActor => actor !== null);
  return (
    actors.some(
      (actor) => actor.nickname?.toLowerCase().includes(term) || actor.user_id.toLowerCase().startsWith(term),
    ) ||
    // 대상 물건 id(문의 id · 설정 키)로도 찾는다
    (log.target_id?.toLowerCase().startsWith(term) ?? false)
  );
}

function AuditLogTable({ range, action, find }: { range: DateRange; action: string; find: string }) {
  const location = useLocation();
  // 기간 · 한 일은 처음 값으로 고정한다(부모 key 가 바뀌면 새로 만들어진다) — 「더 보기」 사이에 조건이 바뀌지 않게
  const [query] = useState(() => ({ ...range, action: action === "all" ? undefined : action }));
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
        const all = extra ? appendUnique(first.logs, extra.logs, logIdOf) : first.logs;
        const logs = all.filter((log) => matches(log, find));
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
              「다시 조회」나 다음에 열 때 보입니다. IP 는 앞 두 자리만 보이고, 11/16 확장 전 기록은 대상 · IP ·
              브라우저가 비어 있습니다.
            </p>
            <DataTable
              caption="활동 로그"
              rows={logs}
              rowKey={logIdOf}
              minWidth={1080}
              emptyText={
                find
                  ? `「${find}」 에 맞는 기록이 받아 둔 ${formatNumber(all.length)}건 안에 없습니다.`
                  : "이 기간 · 종류의 기록이 없습니다."
              }
              columns={[
                {
                  key: "at",
                  header: "시각",
                  mono: true,
                  width: "150px",
                  render: (log) => formatDateTime(log.created_at),
                },
                { key: "admin", header: "관리자", width: "12%", render: (log) => <Actor actor={log.admin} /> },
                {
                  key: "action",
                  header: "한 일",
                  width: "132px",
                  render: (log) => (
                    <Badge tone={log.action === "read_user" ? "blue" : "gray"}>{auditActionLabel(log.action)}</Badge>
                  ),
                },
                {
                  key: "target",
                  header: "대상 회원",
                  width: "12%",
                  render: (log) =>
                    log.target ? <Actor actor={log.target} link /> : <span className="adm-muted">—</span>,
                },
                {
                  key: "object",
                  header: "대상",
                  width: "16%",
                  truncate: (log) => (log.target_type && log.target_id ? `${log.target_type} ${log.target_id}` : ""),
                  render: (log) => <TargetObject log={log} />,
                },
                {
                  key: "ip",
                  header: "IP",
                  mono: true,
                  width: "104px",
                  render: (log) => log.client_ip_display ?? <span className="adm-muted">—</span>,
                },
                {
                  key: "ua",
                  header: "브라우저",
                  truncate: (log) => log.user_agent ?? "",
                  render: (log) => log.user_agent ?? <span className="adm-muted">—</span>,
                },
                { key: "id", header: "기록 번호", mono: true, align: "end", width: "84px", render: (log) => log.id },
              ]}
            />
            <footer className="adm-table-foot">
              <span className="adm-table-foot__count">
                {find
                  ? `「${find}」 ${formatNumber(logs.length)}건 · 받아 둔 ${formatNumber(all.length)}건 중`
                  : `${formatNumber(logs.length)}건 표시`}
                {nextOffset === null ? " · 마지막까지 모두" : ""}
              </span>
              <button type="button" className="adm-button adm-button--ghost adm-button--small" onClick={retry}>
                다시 조회
              </button>
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

/** 대상 물건을 여는 주소 — 회원은 상세, 문의 · 공지는 그 화면의 ?open= 창, 설정은 설정 화면. 모르는 종류는 없다 */
function targetHref(targetType: string, targetId: string): string | null {
  if (targetType === "user") return ADMIN_PATHS.userDetail(targetId);
  if (targetType === "inquiry") return `${ADMIN_PATHS.support}?open=${encodeURIComponent(targetId)}`;
  if (targetType === "notice") return `${ADMIN_PATHS.notices}?open=${encodeURIComponent(targetId)}`;
  if (targetType === "setting") return ADMIN_PATHS.settings;
  return null;
}

/** 열람 · 변경한 대상 물건 — 종류 이름표와 id. 누르면 그 물건으로 간다(지워진 문의 · 공지는 그 화면이 「없음」을 보인다). 확장 전 기록은 비어 있다. */
function TargetObject({ log }: { log: AuditLogEntry }) {
  if (!log.target_type || !log.target_id) return <span className="adm-muted">—</span>;
  const label = auditTargetLabel(log.target_type);
  // UUID 꼴(36자)만 앞 8자로 줄이고, 설정 키 같은 짧은 id 는 그대로 보인다
  const shortId = log.target_id.length >= 32 ? `${log.target_id.slice(0, 8)}…` : log.target_id;
  const href = targetHref(log.target_type, log.target_id);
  return (
    <span>
      {label} ·{" "}
      {href ? (
        <Link to={href} className="is-mono">
          {shortId}
        </Link>
      ) : (
        <span className="is-mono">{shortId}</span>
      )}
    </span>
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
