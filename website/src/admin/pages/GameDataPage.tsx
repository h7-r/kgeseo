import { formatNumber } from "../lib/format";
import type { PreviewData } from "../preview/types";
import { usePreviewData } from "../preview/usePreview";
import BarChart from "../ui/BarChart";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import PageHeader from "../ui/PageHeader";
import Panel from "../ui/Panel";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** 나주 사건(CASE-01)의 진행 · 퍼즐 집계. 퍼즐은 P번호 · 이름만 쓰고 정답 값은 어디에도 두지 않는다. */
export default function GameDataPage() {
  const data = usePreviewData()?.gameData;

  return (
    <>
      <PageHeader
        title="게임 데이터"
        description="나주 사건 「앙암바위」 스테이지 1–5 와 퍼즐별 시도를 봅니다."
        actions={<Badge tone="gray">{data?.contentVersion ?? "naju-angam-01"}</Badge>}
      />
      {!data ? (
        <PendingScreen needs="플레이 집계 API(스테이지 진입 · 완료, 퍼즐 시도 · 오답 · 힌트)가 생기면 열립니다." />
      ) : (
        <GameDataView data={data} />
      )}
    </>
  );
}

function GameDataView({ data }: { data: PreviewData["gameData"] }) {
  const first = data.stages[0];
  const last = data.stages.at(-1);
  const completion = data.stages.map((stage) => ({
    label: stage.label,
    value: percent(stage.completed, stage.entered),
  }));

  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard label="사건 시작" value={formatNumber(first.entered)} unit="명" caption="스테이지 1 진입" />
        <StatCard label="사건 완주" value={formatNumber(last?.completed ?? 0)} unit="명" caption="스테이지 5 완료" />
        <StatCard
          label="완주율"
          value={percent(last?.completed ?? 0, first.entered).toFixed(1)}
          unit="%"
          caption="완주 ÷ 시작"
        />
        <StatCard
          label="평균 완료 시간"
          value={formatNumber(data.avgCompletionMinutes)}
          unit="분"
          caption="완주한 회차"
        />
      </div>
      <div className="adm-grid adm-grid--two">
        <Panel title="스테이지별 완료율" meta="진입 대비 완료 %">
          <BarChart label="스테이지별 완료율" bars={completion} unit="%" fixedTop={100} xAxisLabel="스테이지" />
        </Panel>
        <Panel title="스테이지별 진입 · 완료" meta="명">
          <DataTable
            caption="스테이지별 진입과 완료"
            minWidth={0}
            rows={data.stages}
            rowKey={(row) => row.label}
            emptyText="기록이 없습니다."
            columns={[
              { key: "stage", header: "스테이지", render: (row) => row.label },
              { key: "entered", header: "진입", align: "end", mono: true, render: (row) => formatNumber(row.entered) },
              {
                key: "completed",
                header: "완료",
                align: "end",
                mono: true,
                render: (row) => formatNumber(row.completed),
              },
              {
                key: "rate",
                header: "완료율",
                align: "end",
                mono: true,
                render: (row) => `${percent(row.completed, row.entered).toFixed(1)}%`,
              },
            ]}
          />
        </Panel>
      </div>
      <Panel title="퍼즐별 시도" meta="P번호 · 오답률 = 오답 ÷ 시도">
        <DataTable
          caption="퍼즐별 시도와 오답, 힌트 사용"
          rows={data.puzzles}
          rowKey={(row) => row.id}
          emptyText="기록이 없습니다."
          columns={[
            { key: "id", header: "퍼즐", mono: true, width: "88px", render: (row) => row.id },
            { key: "name", header: "이름", truncate: (row) => row.name, render: (row) => row.name },
            { key: "judge", header: "판정", width: "88px", render: (row) => <Badge tone="gray">{row.judge}</Badge> },
            { key: "attempts", header: "시도", align: "end", mono: true, render: (row) => formatNumber(row.attempts) },
            { key: "wrong", header: "오답", align: "end", mono: true, render: (row) => formatNumber(row.wrong) },
            {
              key: "wrongRate",
              header: "오답률",
              align: "end",
              mono: true,
              render: (row) => `${percent(row.wrong, row.attempts).toFixed(1)}%`,
            },
            { key: "hints", header: "힌트 사용", align: "end", mono: true, render: (row) => formatNumber(row.hints) },
          ]}
        />
      </Panel>
    </>
  );
}
