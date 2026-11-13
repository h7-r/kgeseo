import { Link } from "react-router-dom";

import { fetchSecuritySummary, type SecuritySummary } from "../api/stats";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { auditActionLabel } from "../lib/auditLog";
import { formatDateTime, formatNumber } from "../lib/format";
import { unavailableReason } from "../lib/gameObjectives";
import { ADMIN_PATHS } from "../paths";
import Badge from "../ui/Badge";
import BarChart from "../ui/BarChart";
import DataTable from "../ui/DataTable";
import Panel from "../ui/Panel";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";

/**
 * 보안 이상 신호(security/summary). 로그인 잠김 창 · 관리자 로그인 · 관리자 기록은 실제 값.
 * 429 · 요청 오류 · 채팅 거절 · IP 는 서버에 원천이 없어 「준비 중」 — 무엇이 없어서인지 칸마다 적는다.
 * 이 화면을 열 때마다 「보안 집계 조회」 한 줄이 남는다.
 */
export default function SecurityPage() {
  const [resource, retry] = useAdminResource("security", fetchSecuritySummary);
  return (
    <ResourceView resource={resource} retry={retry} loadingText="보안 집계를 불러오고 있습니다">
      {(summary) => <SecurityView summary={summary} />}
    </ResourceView>
  );
}

function SecurityView({ summary }: { summary: SecuritySummary }) {
  const { login_throttle: throttle, unavailable } = summary;
  const totalActions = summary.audit_actions_24h.reduce((total, bucket) => total + bucket.count, 0);
  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard
          label="로그인 잠김"
          value={formatNumber(throttle.locked_now)}
          unit="건"
          caption="지금 잠긴 계정 · IP 키"
          isAlert={throttle.locked_now > 0}
        />
        <StatCard
          label="로그인 실패 횟수 합(제한 키별)"
          value={formatNumber(throttle.failures_in_window)}
          unit="회"
          caption={`현재 15분 창 · 잠긴 키 포함 · 이메일 · IP 제한 키 ${formatNumber(throttle.keys_with_failures)}개 — 요청 수가 아니라 키별 실패 횟수의 합`}
          isAlert={throttle.keys_with_failures > 0}
        />
        <StatCard
          label="너무 잦은 요청(429)"
          value={null}
          pendingText={`준비 중 — ${unavailableReason(unavailable.rate_limited_429)}`}
          caption="최근 24시간"
        />
        <StatCard
          label="관리자 기록"
          value={formatNumber(totalActions)}
          unit="건"
          caption="최근 24시간 · 열람 · 조회"
        />
      </div>
      <p className="adm-summary__note">
        {formatDateTime(summary.generated_at)} 집계. 로그인 잠김은 서버가 지금 들고 있는 창의 값이라 이력은 없고, 429
        횟수는 서버 메모리에만 있어 아직 집계하지 않습니다. IP 는 기록하지 않습니다.
      </p>
      <div className="adm-grid adm-grid--two">
        <Panel title="관리자 열람 · 조회" meta="최근 24시간 · 종류별 건">
          {summary.audit_actions_24h.length ? (
            <BarChart
              label="최근 24시간 관리자 기록 종류별 건수"
              bars={summary.audit_actions_24h.map((bucket) => ({
                label: auditActionLabel(bucket.label),
                value: bucket.count,
              }))}
              unit="건"
              xAxisLabel="종류"
            />
          ) : (
            <p className="adm-dashboard-note">최근 24시간 기록이 없습니다.</p>
          )}
          <Link to={ADMIN_PATHS.activity} className="adm-button adm-button--ghost adm-button--small">
            활동 로그에서 자세히
          </Link>
        </Panel>
        <Panel title="관리자 로그인" meta="최근 7일 · 로그인 · 가입 때 만든 세션 기준">
          <DataTable
            caption="최근 7일 관리자 로그인"
            rows={summary.admin_logins_7d}
            rowKey={(row) => `${row.user_id}-${row.at}`}
            emptyText="최근 7일 관리자 로그인이 없습니다."
            minWidth={0}
            columns={[
              {
                key: "who",
                header: "관리자",
                render: (row) =>
                  row.nickname === null ? (
                    <span className="adm-muted">사라진 계정 · {row.user_id.slice(0, 8)}</span>
                  ) : (
                    <b>{row.nickname}</b>
                  ),
              },
              { key: "at", header: "시각", mono: true, width: "168px", render: (row) => formatDateTime(row.at) },
              { key: "ip", header: "IP", width: "120px", render: () => <Badge tone="gray">기록 안 함</Badge> },
            ]}
          />
        </Panel>
      </div>
      <div className="adm-grid adm-grid--two">
        <Panel title="실패가 몰린 IP" meta="최근 24시간">
          <PendingScreen
            compact
            needs={`${unavailableReason(unavailable.hot_ips)} — IP 기록 방침(D15)이 정해진 뒤 열립니다.`}
          />
        </Panel>
        <Panel title="요청 오류 · 채팅 거절" meta="최근 24시간">
          <PendingScreen
            compact
            needs={`${unavailableReason(unavailable.request_errors)} · ${unavailableReason(unavailable.chat_rejections)} — 서버가 쌓기 시작하면 열립니다.`}
          />
        </Panel>
      </div>
    </>
  );
}
