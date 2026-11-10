import { formatNumber, maskIp } from "../lib/format";
import { stageLabel } from "../lib/gameStage";
import { useQueryChoice } from "../lib/useQueryChoice";
import { usePreviewData } from "../preview/usePreview";
import DataTable from "../ui/DataTable";
import LineChart from "../ui/LineChart";
import PageHeader from "../ui/PageHeader";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";

const RANGES = [
  { id: "live", label: "실시간" },
  { id: "hourly", label: "시간별" },
  { id: "daily", label: "일별" },
  { id: "monthly", label: "월별" },
] as const;

export default function TrafficPage() {
  const data = usePreviewData()?.traffic;
  const [range, setRange] = useQueryChoice("range", RANGES, "live");
  const lastLabel = data?.perMinute.at(-1)?.label;

  return (
    <>
      <PageHeader
        title="접속 통계"
        description="동시접속과 지금 플레이 중인 조사관을 봅니다."
        actions={<PillTabs label="기간" items={RANGES} activeId={range} onSelect={setRange} />}
      />
      {!data ? (
        <PendingScreen needs="접속 집계 API(동시접속 · DAU · MAU · 활성 세션)가 생기면 열립니다." />
      ) : (
        <>
          <div className="adm-grid adm-grid--four">
            <StatCard label="현재 동시접속" value={formatNumber(data.concurrent)} unit="명" caption="실시간" />
            <StatCard
              label="오늘 최대 동시접속"
              value={formatNumber(data.peakToday)}
              unit="명"
              caption="오늘 0시부터"
            />
            <StatCard label="오늘 DAU" value={formatNumber(data.dau)} unit="명" caption="오늘 0시부터" />
            <StatCard label="MAU" value={formatNumber(data.mau)} unit="명" caption="최근 30일" />
          </div>
          <Panel title="접속자 추이" meta={range === "live" ? `1분 단위 · ${lastLabel} 기준` : undefined}>
            {range === "live" ? (
              <LineChart
                label="최근 1시간 분당 동시접속자"
                series={{ name: "동시접속", points: data.perMinute }}
                unit="명"
                xAxisLabel="시각(시:분)"
                height={280}
              />
            ) : (
              <PendingScreen compact needs="미리보기 데이터는 실시간만 있습니다." />
            )}
          </Panel>
          <Panel title="활성 세션" meta="지금 플레이 중 · IP 뒷자리 가림">
            <DataTable
              caption="활성 세션"
              rows={data.sessions}
              rowKey={(row) => `${row.startedAt}-${row.nickname}`}
              emptyText="플레이 중인 조사관이 없습니다."
              columns={[
                {
                  key: "nickname",
                  header: "닉네임",
                  truncate: (row) => row.nickname,
                  render: (row) => <b>{row.nickname}</b>,
                },
                { key: "stage", header: "현재 단계", width: "160px", render: (row) => stageLabel(row.stage) },
                { key: "started", header: "시작 시각", mono: true, width: "180px", render: (row) => row.startedAt },
                { key: "ip", header: "접속 IP", mono: true, width: "180px", render: (row) => maskIp(row.ip) },
              ]}
            />
          </Panel>
        </>
      )}
    </>
  );
}
