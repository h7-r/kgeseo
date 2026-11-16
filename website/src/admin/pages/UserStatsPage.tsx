import { Link } from "react-router-dom";

import { fetchStatsMembers, type StatsMembers } from "../api/stats";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { changePercentOf } from "../lib/dateRange";
import { formatDateTime, formatDelta, formatNumber, maskEmail } from "../lib/format";
import { unavailableReason } from "../lib/gameObjectives";
import { stageLabel } from "../lib/gameStage";
import { providerLabel } from "../lib/memberSearch";
import { useQueryChoice } from "../lib/useQueryChoice";
import { ADMIN_PATHS } from "../paths";
import BarChart from "../ui/BarChart";
import DataTable from "../ui/DataTable";
import LineChart from "../ui/LineChart";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";

const MONTHS = [
  { id: "6", label: "6개월" },
  { id: "12", label: "12개월" },
] as const;

/** 제목 오른쪽 기간 탭. */
export function MemberStatsRangeTabs() {
  const [months, setMonths] = useQueryChoice("months", MONTHS, "6");
  return <PillTabs label="기간" items={MONTHS} activeId={months} onSelect={setMonths} />;
}

const delta = (current: number, previous: number, higherIsBetter: boolean) => {
  const percent = changePercentOf(current, previous);
  return percent === null ? undefined : formatDelta(percent, higherIsBetter);
};

/** 회원 통계(stats/members). 이 화면을 열 때마다 「회원 통계 조회」 한 줄이 남는다(최근 가입자 목록 때문). 탈퇴 · 정지는 기능 전이라 준비 중. */
export default function UserStatsPage() {
  const [months] = useQueryChoice("months", MONTHS, "6");
  const span = Number(months);
  const [resource, retry] = useAdminResource(`members:${span}`, (signal) => fetchStatsMembers(span, false, signal));
  return (
    <ResourceView resource={resource} retry={retry} loadingText="회원 통계를 불러오고 있습니다">
      {(stats) => <MemberStatsView stats={stats} />}
    </ResourceView>
  );
}

function MemberStatsView({ stats }: { stats: StatsMembers }) {
  const { totals } = stats;
  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard
          label="총 회원"
          value={formatNumber(totals.total)}
          unit="명"
          caption={`지난달 말 ${formatNumber(totals.total_at_prev_month_end)}명 대비`}
          delta={delta(totals.total, totals.total_at_prev_month_end, true)}
        />
        <StatCard
          label="이번 달 신규 가입"
          value={formatNumber(totals.signups_this_month)}
          unit="명"
          caption={`지난달 ${formatNumber(totals.signups_prev_month)}명 대비`}
          delta={delta(totals.signups_this_month, totals.signups_prev_month, true)}
        />
        <StatCard
          label="활성 회원(MAU)"
          value={formatNumber(totals.mau)}
          unit="명"
          caption={`최근 30일 · 그 전 30일 ${formatNumber(totals.mau_prev_30_days)}명 대비`}
          delta={delta(totals.mau, totals.mau_prev_30_days, true)}
        />
        <StatCard
          label="월 이탈률"
          value={null}
          pendingText={`준비 중 — ${unavailableReason(stats.unavailable.churn_rate)}`}
          caption="탈퇴 ÷ 월초 회원"
        />
      </div>
      <p className="adm-summary__note">
        {stats.date} 한국 날짜 기준 · {formatDateTime(stats.generated_at)} 집계 · 관리자 · 테스트 계정 제외.
      </p>
      <div className="adm-grid adm-grid--two">
        <Panel title="월별 가입" meta={`최근 ${stats.months}개월 · 탈퇴는 기능 전이라 없음`}>
          <LineChart
            label={`최근 ${stats.months}개월 월별 가입`}
            series={{
              name: "가입",
              points: stats.monthly_signups.map((m) => ({ label: m.month.slice(2), value: m.signups })),
            }}
            unit="명"
            xAxisLabel="월(연-월)"
          />
        </Panel>
        <Panel title="지역별 분포" meta="가입 때 고른 지역 · 명">
          <BarChart
            label="지역별 회원 수"
            bars={stats.by_region.map((bucket) => ({ label: bucket.label, value: bucket.count }))}
            unit="명"
            xAxisLabel="지역"
          />
        </Panel>
      </div>
      <div className="adm-grid adm-grid--two">
        <Panel title="로그인 수단" meta="한 회원이 둘이면 둘 다 셈 · 명">
          <BarChart
            label="로그인 수단별 회원 수"
            bars={stats.by_provider.map((bucket) => ({ label: providerLabel(bucket.label), value: bucket.count }))}
            unit="명"
            xAxisLabel="수단"
          />
        </Panel>
        <Panel title="오늘 가입" meta={`${stats.date} · ${formatNumber(stats.signups_on_date.length)}명`}>
          <SignupTable rows={stats.signups_on_date} emptyText="오늘 가입한 회원이 없습니다." />
        </Panel>
      </div>
      <Panel title="최근 가입자" meta="최신 20명 · 이메일 가림">
        <SignupTable rows={stats.recent_signups} emptyText="가입한 회원이 없습니다." />
      </Panel>
    </>
  );
}

export function SignupTable({ rows, emptyText }: { rows: StatsMembers["recent_signups"]; emptyText: string }) {
  return (
    <DataTable
      caption="가입자"
      rows={rows}
      rowKey={(row) => row.user_id}
      emptyText={emptyText}
      minWidth={0}
      columns={[
        {
          key: "nickname",
          header: "닉네임",
          truncate: (row) => row.nickname,
          render: (row) => <Link to={ADMIN_PATHS.userDetail(row.user_id)}>{row.nickname}</Link>,
        },
        {
          key: "email",
          header: "이메일",
          mono: true,
          truncate: (row) => maskEmail(row.email),
          render: (row) => maskEmail(row.email),
        },
        {
          key: "region",
          header: "지역",
          width: "96px",
          render: (row) => row.region ?? <span className="adm-muted">—</span>,
        },
        {
          key: "joined",
          header: "가입 시각",
          mono: true,
          width: "168px",
          render: (row) => formatDateTime(row.created_at),
        },
        { key: "stage", header: "진행 단계", width: "120px", render: (row) => stageLabel(row.stage) },
      ]}
    />
  );
}
