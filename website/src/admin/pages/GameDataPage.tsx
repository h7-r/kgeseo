import { fetchStatsGame, type StatsGame } from "../api/stats";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { formatDateTime, formatNumber, percent } from "../lib/format";
import { funnelLabel, judgeLabel, objectiveName, stageName, unavailableReason } from "../lib/gameObjectives";
import { useQueryChoice } from "../lib/useQueryChoice";
import BarChart from "../ui/BarChart";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";

const RANGES = [
  { id: "7", label: "7일" },
  { id: "30", label: "30일" },
  { id: "92", label: "92일" },
] as const;

/** 베타 기록의 4 · 5스테이지 굵은 표식 — 세부 목표(P14 … P16)가 들어오기 전 진입 표시용. 퍼즐 표에서는 뺀다 */
const INTERIM_MARKERS: ReadonlySet<string> = new Set(["CLIFF", "GUT"]);

/** 제목 오른쪽 기간 탭. */
export function GameDataRangeTabs() {
  const [range, setRange] = useQueryChoice("range", RANGES, "30");
  return <PillTabs label="기간" items={RANGES} activeId={range} onSelect={setRange} />;
}

/** 나주 사건(CASE-01)의 진행 · 퍼즐 집계(stats/game, beta_events). 퍼즐은 ID · 이름만 쓰고 정답 값은 어디에도 없다. */
export default function GameDataPage() {
  const [range] = useQueryChoice("range", RANGES, "30");
  const days = Number(range);
  const [resource, retry] = useAdminResource(`game:${days}`, (signal) => fetchStatsGame(days, signal));
  return (
    <ResourceView resource={resource} retry={retry} loadingText="게임 집계를 불러오고 있습니다">
      {(game) => <GameDataView game={game} />}
    </ResourceView>
  );
}

function GameDataView({ game }: { game: StatsGame }) {
  const first = game.stages[0];
  const last = game.stages.at(-1);
  // 사건 완주 = 엔딩까지 간 사람(서버가 주면). 아직 안 주는 서버면 마지막 스테이지 완료 인원
  const finished = game.case_completed_people ?? last?.completed ?? null;
  const finishedCaption =
    game.case_completed_people !== undefined ? "사건 완주(풀려남 · 새벽)" : last ? `${stageName(last.stage)} 완료` : null;
  // 진입만 세는 스테이지(임시 필드)는 표 끝에 「진입만」으로 — 같은 번호가 stages 로 들어오면 그쪽만 보인다
  const known = new Set(game.stages.map((stage) => stage.stage));
  const stageRows: { stage: number; entered: number; completed: number | null }[] = [
    ...game.stages,
    ...(game.entry_only_stages ?? [])
      .filter((row) => !known.has(row.stage))
      .map((row) => ({ ...row, completed: null })),
  ];
  const median = game.median_completion_minutes ?? null;
  const completion = game.stages.map((stage) => ({
    label: `${stage.stage}단계`,
    value: percent(stage.completed, stage.entered),
  }));
  // 판정 없는 걸음은 기록이 있을 때만 보인다 — 표가 길어지지 않게. CLIFF · GUT 는 4 · 5스테이지의 굵은 표식이라 퍼즐 완료로 안 센다(세진 11/16)
  const puzzles = game.puzzles.filter(
    (p) => !INTERIM_MARKERS.has(p.objective_id) && (p.judge !== "step" || p.attempts > 0 || p.completed_people > 0),
  );

  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard label="집계 인원" value={formatNumber(game.people)} unit="명" caption="회원 · 게스트 · 탭 단위" />
        <StatCard
          label="사건 시작"
          value={first ? formatNumber(first.entered) : null}
          unit="명"
          caption={first ? `${stageName(first.stage)} 진입` : "집계 없음"}
        />
        <StatCard
          label="사건 완주"
          value={finished === null ? null : formatNumber(finished)}
          unit="명"
          caption={
            finished !== null && finishedCaption
              ? `${finishedCaption} · 완주율 ${percent(finished, first?.entered ?? 0)}%`
              : "집계 없음"
          }
        />
        <StatCard
          label="평균 완료 시간"
          value={game.avg_completion_minutes === null ? null : formatNumber(Math.round(game.avg_completion_minutes))}
          pendingText={`준비 중 — ${unavailableReason(game.unavailable.avg_completion_minutes)}`}
          unit="분"
          caption={`${median === null ? "" : `중앙값 ${formatNumber(Math.round(median))}분 · `}사건 완주 회차 ${formatNumber(game.completed_runs)}개`}
        />
      </div>
      <p className="adm-summary__note">
        최근 {game.days}일({game.date} 까지, 한국 날짜) · {formatDateTime(game.generated_at)} 집계 · 베타
        기록(beta_events)을 사람 단위로 센 값입니다. 복원된 완료는 빼고, 같은 사람이 여러 번 완료해도 한 번으로 셉니다.
        {game.unavailable.truncated &&
          " · 기록이 20만 건을 넘어 앞(오래된) 20만 건만 셌습니다. 기간 뒤쪽이 빠져 모든 숫자가 실제보다 작으니 기간을 줄여 다시 보세요."}
      </p>
      <div className="adm-grid adm-grid--two">
        <Panel title="게임 진입 깔때기" meta="단계별 도달 인원 · 명">
          <BarChart
            label="게임 진입 단계별 인원"
            bars={game.funnel.map((step) => ({ label: funnelLabel(step.phase), value: step.people }))}
            unit="명"
            xAxisLabel="단계"
          />
        </Panel>
        <Panel title="스테이지별 완료율" meta="진입 대비 완료 %">
          <BarChart label="스테이지별 완료율" bars={completion} unit="%" fixedTop={100} xAxisLabel="스테이지" />
        </Panel>
      </div>
      <Panel title="스테이지별 진입 · 완료" meta="명 · 완료 = 그 스테이지 끝 걸음을 마친 사람">
        <DataTable
          caption="스테이지별 진입과 완료"
          minWidth={0}
          rows={stageRows}
          rowKey={(row) => String(row.stage)}
          emptyText="기록이 없습니다."
          columns={[
            { key: "stage", header: "스테이지", render: (row) => stageName(row.stage) },
            { key: "entered", header: "진입", align: "end", mono: true, render: (row) => formatNumber(row.entered) },
            {
              key: "completed",
              header: "완료",
              align: "end",
              mono: true,
              render: (row) =>
                row.completed === null ? <Badge tone="gray">진입만</Badge> : formatNumber(row.completed),
            },
            {
              key: "rate",
              header: "완료율",
              align: "end",
              mono: true,
              render: (row) => (row.completed === null ? "—" : `${percent(row.completed, row.entered).toFixed(1)}%`),
            },
          ]}
        />
      </Panel>
      <Panel title="퍼즐별 시도" meta="오답률 = 오답 ÷ 시도 · 힌트 = 동행에게 도움 요청 건수">
        <DataTable
          caption="퍼즐별 시도와 오답, 힌트 사용"
          rows={puzzles}
          rowKey={(row) => row.objective_id}
          emptyText="기록이 없습니다."
          columns={[
            { key: "id", header: "ID", mono: true, width: "88px", render: (row) => row.objective_id },
            { key: "name", header: "이름", render: (row) => objectiveName(row.objective_id) },
            {
              key: "judge",
              header: "판정",
              width: "88px",
              render: (row) => <Badge tone={row.judge === "server" ? "blue" : "gray"}>{judgeLabel(row.judge)}</Badge>,
            },
            { key: "attempts", header: "시도", align: "end", mono: true, render: (row) => formatNumber(row.attempts) },
            { key: "wrong", header: "오답", align: "end", mono: true, render: (row) => formatNumber(row.wrong) },
            {
              key: "wrongRate",
              header: "오답률",
              align: "end",
              mono: true,
              render: (row) => (row.attempts ? `${percent(row.wrong, row.attempts).toFixed(1)}%` : "—"),
            },
            {
              key: "hints",
              header: "힌트",
              align: "end",
              mono: true,
              render: (row) => formatNumber(row.hint_requests),
            },
            {
              key: "done",
              header: "완료 인원",
              align: "end",
              mono: true,
              render: (row) => formatNumber(row.completed_people),
            },
          ]}
        />
      </Panel>
    </>
  );
}
