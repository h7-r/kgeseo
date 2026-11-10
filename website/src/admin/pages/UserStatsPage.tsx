import { formatDelta, formatNumber, maskEmail } from "../lib/format";
import { stageLabel } from "../lib/gameStage";
import { usePreviewData } from "../preview/usePreview";
import BarChart from "../ui/BarChart";
import DataTable from "../ui/DataTable";
import LineChart from "../ui/LineChart";
import Panel from "../ui/Panel";
import StatCard from "../ui/StatCard";

/** 연령은 받지 않아 지역만 나눈다. 구독 플랜 분포는 결제 연결 뒤에 넣는다. */
export default function UserStatsPage() {
  const data = usePreviewData()?.memberStats;

  if (!data) return null;

  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard
          label="총 회원"
          value={formatNumber(data.total)}
          unit="명"
          caption="누적 · 지난달 대비"
          delta={formatDelta(data.totalDelta, true)}
        />
        <StatCard
          label="이번 달 신규 가입"
          value={formatNumber(data.monthlySignups)}
          unit="명"
          caption="지난달 대비"
          delta={formatDelta(data.signupDelta, true)}
        />
        <StatCard
          label="활성 회원(MAU)"
          value={formatNumber(data.mau)}
          unit="명"
          caption="최근 30일 · 지난달 대비"
          delta={formatDelta(data.mauDelta, true)}
        />
        <StatCard
          label="월 이탈률"
          value={data.churnRate.toFixed(1)}
          unit="%"
          caption="탈퇴 ÷ 월초 회원 · 지난달 대비"
          delta={formatDelta(data.churnDelta, false)}
        />
      </div>
      <div className="adm-grid adm-grid--two">
        <Panel title="가입 · 탈퇴 추이" meta="최근 6개월 · 월 단위">
          <LineChart
            label="최근 6개월 월별 가입과 탈퇴"
            series={{ name: "가입", points: data.signups6m }}
            compare={{ name: "탈퇴", points: data.withdrawals6m }}
            unit="명"
            xAxisLabel="월"
          />
        </Panel>
        <Panel title="지역별 분포" meta="가입 때 고른 지역 · 명">
          <BarChart label="지역별 회원 수" bars={data.regions} unit="명" xAxisLabel="지역" />
        </Panel>
      </div>
      <Panel title="최근 가입자" meta="이메일 가림">
        <DataTable
          caption="최근 가입자"
          rows={data.recent}
          rowKey={(row) => row.email}
          emptyText="최근 가입자가 없습니다."
          columns={[
            {
              key: "nickname",
              header: "닉네임",
              truncate: (row) => row.nickname,
              render: (row) => <b>{row.nickname}</b>,
            },
            {
              key: "email",
              header: "이메일",
              mono: true,
              truncate: (row) => maskEmail(row.email),
              render: (row) => maskEmail(row.email),
            },
            { key: "joined", header: "가입 시각", mono: true, width: "180px", render: (row) => row.joinedAt },
            { key: "stage", header: "진행 단계", width: "160px", render: (row) => stageLabel(row.stage) },
          ]}
        />
      </Panel>
    </>
  );
}
