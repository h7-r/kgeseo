import { Link } from "react-router-dom";

import { fetchStatsSummary, type StatsSummary } from "../api/stats";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { formatDateTime, formatNumber } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import { ADMIN_PATHS } from "../paths";
import type { PreviewData } from "../preview/types";
import { usePreviewData } from "../preview/usePreview";
import BarChart from "../ui/BarChart";
import LineChart from "../ui/LineChart";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";
import ServerStatusPanel from "./ServerStatusPanel";

/** 회원 통계에 관리자 계정을 넣을지(관리자 API v0.2 D7). 기본은 뺀다. */
const SCOPES = [
  { id: "members", label: "관리자 제외" },
  { id: "all", label: "관리자 포함" },
] as const;

const useStatsScope = () => useQueryChoice("scope", SCOPES, "members");

/** 제목 오른쪽 범위 탭. */
export function StatsScopeTabs() {
  const [scope, setScope] = useStatsScope();
  return <PillTabs label="회원 통계 범위" items={SCOPES} activeId={scope} onSelect={setScope} />;
}

/** 숫자 카드는 통계 요약 API 의 실제 값이다. 그래프는 시계열 · 게임 진행 집계 API 가 생기면 연결한다. 매출 카드는 결제 연결 전이라 두지 않는다. */
export default function DashboardPage() {
  const preview = usePreviewData()?.dashboard;
  const [scope] = useStatsScope();
  const [resource, retry] = useAdminResource(`stats:${scope}`, (signal) => fetchStatsSummary(scope === "all", signal));

  return (
    <>
      <ResourceView resource={resource} retry={retry} loadingText="오늘 숫자를 불러오고 있습니다">
        {(stats) => <SummaryCards stats={stats} preview={preview} />}
      </ResourceView>

      <div className="adm-grid adm-grid--two">
        <Panel title="접속자 추이" meta="최근 7일 · 일 단위">
          {preview ? (
            <LineChart
              label="최근 7일 일별 접속자"
              series={{ name: "접속자", points: preview.visitors7d }}
              unit="명"
              xAxisLabel="날짜(월-일)"
            />
          ) : (
            <PendingScreen compact needs="날짜별 접속 집계 API 가 생기면 열립니다." />
          )}
        </Panel>
        <Panel title="스테이지별 완료율" meta="나주 사건 · 진입 대비 완료 %">
          {preview ? (
            <BarChart
              label="나주 사건 스테이지별 완료율"
              bars={preview.stageCompletion}
              unit="%"
              fixedTop={100}
              xAxisLabel="스테이지"
            />
          ) : (
            <PendingScreen compact needs="게임 진행 집계 API 가 생기면 열립니다." />
          )}
        </Panel>
      </div>

      <Panel title="최근 관리자 기록" meta="누가 · 무엇을 · 언제">
        <p className="adm-dashboard-note">
          활동 로그 화면에서 봅니다. 기록을 볼 때마다 조회 기록이 한 줄씩 남아 대시보드에서는 따로 부르지 않습니다.
        </p>
        <Link to={ADMIN_PATHS.activity} className="adm-button adm-button--ghost adm-button--small">
          활동 로그 열기
        </Link>
      </Panel>

      <ServerStatusPanel />
    </>
  );
}

/** 동시접속 · 미답변 문의는 서버에 원천이 없어 「준비 중」이다. 개발 미리보기에서만 가짜 값으로 모양을 본다. */
function SummaryCards({ stats, preview }: { stats: StatsSummary; preview?: PreviewData["dashboard"] }) {
  const { members, activity, excluded } = stats;
  return (
    <section className="adm-summary" aria-label="오늘 숫자">
      <div className="adm-grid adm-grid--stats">
        <StatCard
          label="동시접속자"
          value={preview ? formatNumber(preview.concurrent) : null}
          pendingText="준비 중 — 로비 집계 연결 전"
          unit="명"
          caption="실시간"
        />
        <StatCard
          label="오늘 DAU"
          value={formatNumber(activity.members_dau)}
          unit="명"
          caption={`게스트 ${formatNumber(activity.guests_dau)}명 따로`}
        />
        <StatCard label="총 회원수" value={formatNumber(members.total)} unit="명" caption="누적" />
        <StatCard
          label="오늘 신규 가입"
          value={formatNumber(members.signups_on_date)}
          unit="명"
          caption={`이번 달 ${formatNumber(members.signups_in_month)}명`}
        />
        <StatCard
          label="미답변 문의"
          value={preview ? formatNumber(preview.openInquiries) : null}
          pendingText="준비 중 — 문의 API 연결 전"
          unit="건"
          caption="답변 대기"
          isAlert={(preview?.openInquiries ?? 0) > 0}
        />
      </div>
      <p className="adm-summary__note">
        {stats.date} 한국 시각 기준 · {formatDateTime(stats.generated_at)} 집계 ·{" "}
        {stats.include_internal ? "관리자 포함" : `관리자 ${formatNumber(excluded.admins)}명 제외`}
        {excluded.test_accounts === null && " · 테스트 계정은 아직 가려내지 못해 들어 있습니다"}
      </p>
      <p className="adm-summary__note">
        DAU 는 그날 로그인하거나 플레이를 새로 시작한 회원 수입니다. 이어 하기만 한 회원은 빠질 수 있어 실제보다 적게
        나올 수 있습니다.
      </p>
    </section>
  );
}
