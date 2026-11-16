import { fetchActiveSessions, fetchStatsTraffic, type StatsTraffic, type TrafficDay } from "../api/stats";
import { useAdminResource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { formatDateTime, formatNumber } from "../lib/format";
import { unavailableReason } from "../lib/gameObjectives";
import { useQueryChoice } from "../lib/useQueryChoice";
import DataTable from "../ui/DataTable";
import LineChart from "../ui/LineChart";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";

const RANGES = [
  { id: "7", label: "7일" },
  { id: "30", label: "30일" },
  { id: "92", label: "92일" },
] as const;

/** 제목 오른쪽 기간 탭 — 날짜별 집계라 일 단위만 있다(분 · 시간 단위 원천은 없다). */
export function TrafficRangeTabs() {
  const [range, setRange] = useQueryChoice("range", RANGES, "7");
  return <PillTabs label="기간" items={RANGES} activeId={range} onSelect={setRange} />;
}

/** "2026-11-12" → "11-12" */
const dayLabel = (iso: string) => iso.slice(5);

/** 접속 통계 — 날짜별 DAU · 가입 · 플레이 세션(stats/traffic)과 지금 플레이 중(active-sessions). 동시접속은 로비 집계 전이라 「준비 중」. */
export default function TrafficPage() {
  const [range] = useQueryChoice("range", RANGES, "7");
  const days = Number(range);
  const [resource, retry] = useAdminResource(`traffic:${days}`, (signal) => fetchStatsTraffic(days, false, signal));

  return (
    <ResourceView resource={resource} retry={retry} loadingText="접속 집계를 불러오고 있습니다">
      {(traffic) => <TrafficView traffic={traffic} />}
    </ResourceView>
  );
}

function TrafficView({ traffic }: { traffic: StatsTraffic }) {
  const today = traffic.daily.at(-1);
  const sum = (pick: (day: TrafficDay) => number) => traffic.daily.reduce((total, day) => total + pick(day), 0);
  const points = (pick: (day: TrafficDay) => number) =>
    traffic.daily.map((day) => ({ label: dayLabel(day.date), value: pick(day) }));

  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard
          label="지금 플레이 중"
          value={formatNumber(traffic.live.active_play_sessions_5m)}
          unit="세션"
          caption="최근 5분 안에 저장이 갱신된 플레이 세션 · 접속 여부의 근사치"
        />
        <StatCard
          label="동시접속(로비)"
          value={null}
          pendingText={`준비 중 — ${unavailableReason(traffic.unavailable.lobby_concurrent)}`}
          caption="실시간"
        />
        <StatCard
          label="오늘 DAU"
          value={today ? formatNumber(today.members_dau) : null}
          unit="명"
          caption={today ? `게스트 ${formatNumber(today.guests_dau)}명 따로` : "오늘 집계 없음"}
        />
        <StatCard
          label={`${traffic.days}일 가입`}
          value={formatNumber(sum((day) => day.signups))}
          unit="명"
          caption={`플레이 세션 ${formatNumber(sum((day) => day.play_sessions_created))}개 시작`}
        />
      </div>
      <p className="adm-summary__note">
        {traffic.daily[0]?.date} ~ {traffic.date} 한국 날짜 · {formatDateTime(traffic.generated_at)} 집계 · 관리자 ·
        테스트 계정 제외. DAU 는 그날 로그인하거나 플레이를 새로 시작한 회원 수라 이어 하기만 한 회원은 빠질 수
        있습니다. 게스트로 놀다 뒤에 로그인한 사람은 그날엔 게스트로 남습니다(세션을 만든 때의 소유자 기준).
      </p>
      <div className="adm-grid adm-grid--two">
        <Panel title="회원 DAU 추이" meta="일 단위 · 회색 점선은 게스트">
          <LineChart
            label={`최근 ${traffic.days}일 일별 회원 DAU`}
            series={{ name: "회원", points: points((day) => day.members_dau) }}
            compare={{ name: "게스트", points: points((day) => day.guests_dau) }}
            unit="명"
            xAxisLabel="날짜(월-일)"
          />
        </Panel>
        <Panel title="가입 · 플레이 시작 추이" meta="일 단위 · 회색 점선은 플레이 세션">
          <LineChart
            label={`최근 ${traffic.days}일 일별 가입`}
            series={{ name: "가입", points: points((day) => day.signups) }}
            compare={{ name: "플레이 세션", points: points((day) => day.play_sessions_created) }}
            unit="건"
            xAxisLabel="날짜(월-일)"
          />
        </Panel>
      </div>
      <ActiveSessionsPanel windowMinutes={5} />
      <Panel title="날짜별 숫자" meta="한국 날짜 · 명 · 건">
        <DataTable
          caption="날짜별 접속 집계"
          rows={[...traffic.daily].reverse()}
          rowKey={(day) => day.date}
          emptyText="집계가 없습니다."
          minWidth={0}
          columns={[
            { key: "date", header: "날짜", mono: true, width: "128px", render: (day) => day.date },
            { key: "m", header: "회원 DAU", align: "end", mono: true, render: (day) => formatNumber(day.members_dau) },
            { key: "g", header: "게스트 DAU", align: "end", mono: true, render: (day) => formatNumber(day.guests_dau) },
            { key: "s", header: "가입", align: "end", mono: true, render: (day) => formatNumber(day.signups) },
            {
              key: "p",
              header: "플레이 세션",
              align: "end",
              mono: true,
              render: (day) => formatNumber(day.play_sessions_created),
            },
          ]}
        />
      </Panel>
    </>
  );
}

/** 지금 플레이 중인 세션 — play_sessions.updated_at 기준이라 실제 접속의 근사치다(세진 11/12). 열 때마다 「활성 세션 조회」 한 줄이 남는다. IP 는 서버가 기록하지 않는다. */
function ActiveSessionsPanel({ windowMinutes }: { windowMinutes: number }) {
  const [resource, retry] = useAdminResource("active-sessions", fetchActiveSessions);
  return (
    <Panel
      title="지금 플레이 중"
      meta={`최근 ${windowMinutes}분 안에 저장이 갱신된 세션 · 근사치 · 최신순 · 조회할 때마다 관리자 기록에 남음`}
      actions={
        <button type="button" className="adm-button adm-button--ghost adm-button--small" onClick={retry}>
          다시 조회
        </button>
      }
    >
      <ResourceView resource={resource} retry={retry} loadingText="활성 세션을 불러오고 있습니다">
        {(list) => (
          <DataTable
            caption="지금 플레이 중인 세션"
            rows={list.sessions}
            rowKey={(row) => `${row.user_id ?? "guest"}-${row.started_at}`}
            emptyText="최근 5분 안에 저장이 갱신된 세션이 없습니다."
            minWidth={0}
            columns={[
              {
                key: "who",
                header: "누구",
                render: (row) => (row.nickname ? <b>{row.nickname}</b> : <span className="adm-muted">게스트</span>),
              },
              { key: "case", header: "사건", mono: true, width: "120px", render: (row) => row.case_id },
              {
                key: "started",
                header: "시작",
                mono: true,
                width: "168px",
                render: (row) => formatDateTime(row.started_at),
              },
              {
                key: "seen",
                header: "마지막 저장 갱신",
                mono: true,
                width: "168px",
                render: (row) => formatDateTime(row.last_seen_at),
              },
            ]}
          />
        )}
      </ResourceView>
    </Panel>
  );
}
