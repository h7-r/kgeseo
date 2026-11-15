import { useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchStatsGame,
  fetchStatsMembers,
  fetchStatsSummary,
  fetchStatsTraffic,
  type StatsMembers,
  type StatsSummary,
} from "../api/stats";
import { useAdminResource, type Resource } from "../api/useAdminResource";
import ResourceView from "../auth/ResourceView";
import { formatDateTime, formatNumber, percent } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import { ADMIN_PATHS } from "../paths";
import BarChart from "../ui/BarChart";
import LineChart from "../ui/LineChart";
import Modal from "../ui/Modal";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";
import ServerStatusPanel from "./ServerStatusPanel";
import { SignupTable } from "./UserStatsPage";

/** 회원 통계에 관리자 계정을 넣을지(관리자 API v0.2 D7). 기본은 뺀다. */
const SCOPES = [
  { id: "members", label: "관리자 · 테스트 계정 제외" },
  { id: "all", label: "관리자 · 테스트 계정 포함" },
] as const;

const useStatsScope = () => useQueryChoice("scope", SCOPES, "members");

/** 제목 오른쪽 범위 탭. */
export function StatsScopeTabs() {
  const [scope, setScope] = useStatsScope();
  return <PillTabs label="회원 통계 범위" items={SCOPES} activeId={scope} onSelect={setScope} />;
}

type Detail = "dau" | "members" | "signups" | "sessions";

/**
 * 대시보드. 숫자 카드는 통계 요약 API 의 실제 값이고, 누르면 가운데 창에서 「누가 · 몇 명」을 펼친다.
 * 그래프는 날짜별 접속(stats/traffic) · 게임 집계(stats/game). 문의는 support 메일로 받아 카드 대신 안내만.
 */
export default function DashboardPage() {
  const [scope] = useStatsScope();
  const includeInternal = scope === "all";
  const [resource, retry] = useAdminResource(`stats:${scope}`, (signal) => fetchStatsSummary(includeInternal, signal));
  const [traffic] = useAdminResource(`traffic:7:${scope}`, (signal) => fetchStatsTraffic(7, includeInternal, signal));
  const [game] = useAdminResource("game:30", (signal) => fetchStatsGame(30, signal));
  const [detail, setDetail] = useState<Detail | null>(null);

  return (
    <>
      <ResourceView resource={resource} retry={retry} loadingText="오늘 숫자를 불러오고 있습니다">
        {(stats) => (
          <>
            <SummaryCards stats={stats} onOpen={setDetail} />
            {detail && (
              <DetailModal
                kind={detail}
                stats={stats}
                includeInternal={includeInternal}
                onClose={() => setDetail(null)}
              />
            )}
          </>
        )}
      </ResourceView>

      <div className="adm-grid adm-grid--two">
        <Panel
          title="접속자 추이"
          meta="최근 7일 · 일 단위 · 회색 점선은 게스트"
          actions={
            <Link to={ADMIN_PATHS.traffic} className="adm-button adm-button--ghost adm-button--small">
              접속 통계
            </Link>
          }
        >
          {traffic.status === "ready" ? (
            <LineChart
              label="최근 7일 일별 회원 DAU"
              series={{
                name: "회원 DAU",
                points: traffic.data.daily.map((day) => ({ label: day.date.slice(5), value: day.members_dau })),
              }}
              compare={{
                name: "게스트",
                points: traffic.data.daily.map((day) => ({ label: day.date.slice(5), value: day.guests_dau })),
              }}
              unit="명"
              xAxisLabel="날짜(월-일)"
            />
          ) : (
            <ChartWait resource={traffic} />
          )}
        </Panel>
        <Panel
          title="스테이지별 완료율"
          meta="나주 사건 · 최근 30일 · 진입 대비 완료 %"
          actions={
            <Link to={ADMIN_PATHS.gameData} className="adm-button adm-button--ghost adm-button--small">
              게임 데이터
            </Link>
          }
        >
          {game.status === "ready" ? (
            <BarChart
              label="나주 사건 스테이지별 완료율"
              bars={game.data.stages.map((stage) => ({
                label: `${stage.stage}단계`,
                value: percent(stage.completed, stage.entered),
              }))}
              unit="%"
              fixedTop={100}
              xAxisLabel="스테이지"
            />
          ) : (
            <ChartWait resource={game} />
          )}
        </Panel>
      </div>

      <div className="adm-grid adm-grid--two">
        <Panel title="최근 관리자 기록" meta="누가 · 무엇을 · 언제">
          <p className="adm-dashboard-note">
            활동 로그 화면에서 봅니다. 기록을 볼 때마다 조회 기록이 한 줄씩 남아 대시보드에서는 따로 부르지 않습니다.
          </p>
          <Link to={ADMIN_PATHS.activity} className="adm-button adm-button--ghost adm-button--small">
            활동 로그 열기
          </Link>
        </Panel>
        <Panel title="문의" meta="support@k-escape.com">
          <p className="adm-dashboard-note">
            1:1 문의는 웹 고객센터에서 support 메일로 받습니다(미르 11/12). 문의 API 는 베타 뒤 필요 여부부터 정합니다.
          </p>
        </Panel>
      </div>

      <ServerStatusPanel />
    </>
  );
}

function ChartWait({ resource }: { resource: Resource<unknown> }) {
  return resource.status === "loading" ? (
    <PendingScreen compact needs="불러오는 중…" />
  ) : (
    <PendingScreen compact needs="집계를 불러오지 못했습니다. 새로고침해 주세요." />
  );
}

/** 카드 넷은 누르면 상세 창. 동시접속은 로비 집계 전이라 「준비 중」(누를 수 없다). */
function SummaryCards({ stats, onOpen }: { stats: StatsSummary; onOpen: (kind: Detail) => void }) {
  const { members, activity, excluded, play_sessions: sessions } = stats;
  return (
    <section className="adm-summary" aria-label="오늘 숫자">
      <div className="adm-grid adm-grid--stats">
        <StatCard
          label="동시접속자"
          value={null}
          pendingText="준비 중 — 로비 집계 연결 전"
          unit="명"
          caption="실시간"
        />
        <StatCard
          label="오늘 DAU"
          value={formatNumber(activity.members_dau)}
          unit="명"
          caption={`게스트 ${formatNumber(activity.guests_dau)}명 따로`}
          onOpen={() => onOpen("dau")}
        />
        <StatCard
          label="총 회원수"
          value={formatNumber(members.total)}
          unit="명"
          caption="누적"
          onOpen={() => onOpen("members")}
        />
        <StatCard
          label="오늘 신규 가입"
          value={formatNumber(members.signups_on_date)}
          unit="명"
          caption={`이번 달 ${formatNumber(members.signups_in_month)}명`}
          onOpen={() => onOpen("signups")}
        />
        <StatCard
          label="오늘 플레이 시작"
          value={formatNumber(sessions.created_on_date)}
          unit="개"
          caption={`회원 ${formatNumber(sessions.created_on_date_by_member)} · 게스트 ${formatNumber(sessions.created_on_date_by_guest)}`}
          onOpen={() => onOpen("sessions")}
        />
      </div>
      <p className="adm-summary__note">
        {stats.date} 한국 시각 기준 · {formatDateTime(stats.generated_at)} 집계 ·{" "}
        {stats.include_internal
          ? "관리자 · 테스트 계정 포함"
          : `관리자 ${formatNumber(excluded.admins)}명${excluded.test_accounts === null ? "" : ` · 테스트 계정 ${formatNumber(excluded.test_accounts)}명`} 제외`}
        {excluded.test_accounts === null && " · 테스트 계정은 아직 가려내지 못해 들어 있습니다"} · 카드를 누르면 자세히
        봅니다.
      </p>
      <p className="adm-summary__note">
        DAU 는 그날 로그인하거나 플레이를 새로 시작한 회원 수입니다. 이어 하기만 한 회원은 빠질 수 있어 실제보다 적게
        나올 수 있습니다.
      </p>
    </section>
  );
}

function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <ul className="adm-facts">
      {items.map((item) => (
        <li key={item.label} className="adm-facts__item">
          <span className="adm-facts__label">{item.label}</span>
          <span className="adm-facts__value">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** 카드 상세 창. 신규 가입 · 총 회원은 회원 통계 API 로 이름까지(그 조회는 기록에 남는다 — 창에 적는다). */
function DetailModal({
  kind,
  stats,
  includeInternal,
  onClose,
}: {
  kind: Detail;
  stats: StatsSummary;
  includeInternal: boolean;
  onClose: () => void;
}) {
  const meta = `${stats.date} 한국 시각 기준 · ${includeInternal ? "관리자 · 테스트 계정 포함" : "관리자 · 테스트 계정 제외"}`;
  if (kind === "dau")
    return (
      <Modal title="오늘 DAU" meta={meta} onClose={onClose}>
        <Facts
          items={[
            { label: "회원 DAU", value: `${formatNumber(stats.activity.members_dau)}명` },
            { label: "게스트 DAU", value: `${formatNumber(stats.activity.guests_dau)}명` },
            { label: "회원 MAU(30일)", value: `${formatNumber(stats.activity.members_mau)}명` },
            { label: "게스트 MAU(30일)", value: `${formatNumber(stats.activity.guests_mau)}명` },
          ]}
        />
        <p className="adm-dashboard-note">
          회원은 그날 로그인하거나 플레이를 새로 시작한 사람, 게스트는 브라우저 단위로 셉니다. 날짜별 추이는 접속
          통계에서 봅니다.
        </p>
        <Link to={ADMIN_PATHS.traffic} className="adm-button adm-button--ghost adm-button--small">
          접속 통계 열기
        </Link>
      </Modal>
    );
  if (kind === "sessions")
    return (
      <Modal title="오늘 플레이 시작" meta={meta} onClose={onClose}>
        <Facts
          items={[
            { label: "전체", value: `${formatNumber(stats.play_sessions.created_on_date)}개` },
            { label: "회원", value: `${formatNumber(stats.play_sessions.created_on_date_by_member)}개` },
            { label: "게스트", value: `${formatNumber(stats.play_sessions.created_on_date_by_guest)}개` },
          ]}
        />
        <p className="adm-dashboard-note">
          오늘 새로 만들어진 플레이 세션 수입니다. 지금 플레이 중인 세션은 접속 통계에서 봅니다.
        </p>
      </Modal>
    );
  return (
    <MembersDetailModal kind={kind} stats={stats} includeInternal={includeInternal} meta={meta} onClose={onClose} />
  );
}

function MembersDetailModal({
  kind,
  stats,
  includeInternal,
  meta,
  onClose,
}: {
  kind: "members" | "signups";
  stats: StatsSummary;
  includeInternal: boolean;
  meta: string;
  onClose: () => void;
}) {
  const [resource, retry] = useAdminResource(`members:6:${includeInternal}`, (signal) =>
    fetchStatsMembers(6, includeInternal, signal),
  );
  const title = kind === "signups" ? "오늘 신규 가입" : "총 회원수";
  return (
    <Modal
      title={title}
      meta={`${meta} · 이 창을 열면 「회원 통계 조회」 기록이 한 줄 남습니다`}
      onClose={onClose}
      wide
    >
      <ResourceView resource={resource} retry={retry} loadingText="회원 통계를 불러오고 있습니다">
        {(members) =>
          kind === "signups" ? <SignupsDetail stats={stats} members={members} /> : <MembersDetail members={members} />
        }
      </ResourceView>
    </Modal>
  );
}

function SignupsDetail({ stats, members }: { stats: StatsSummary; members: StatsMembers }) {
  return (
    <>
      <Facts
        items={[
          { label: "오늘", value: `${formatNumber(stats.members.signups_on_date)}명` },
          { label: "이번 달", value: `${formatNumber(members.totals.signups_this_month)}명` },
          { label: "지난달", value: `${formatNumber(members.totals.signups_prev_month)}명` },
        ]}
      />
      <SignupTable rows={members.signups_on_date} emptyText="오늘 가입한 회원이 없습니다." />
      <p className="adm-dashboard-note">
        오늘 가입 50명까지 보입니다. 닉네임을 누르면 회원 상세로 갑니다(그 열람도 기록에 남습니다).
      </p>
    </>
  );
}

function MembersDetail({ members }: { members: StatsMembers }) {
  const { totals } = members;
  return (
    <>
      <Facts
        items={[
          { label: "총 회원", value: `${formatNumber(totals.total)}명` },
          { label: "지난달 말", value: `${formatNumber(totals.total_at_prev_month_end)}명` },
          { label: "활성(MAU)", value: `${formatNumber(totals.mau)}명` },
          {
            label: "로그인 수단",
            value: members.by_provider.map((b) => `${b.label} ${formatNumber(b.count)}`).join(" · ") || "—",
          },
        ]}
      />
      <BarChart
        label="지역별 회원 수"
        bars={members.by_region.map((bucket) => ({ label: bucket.label, value: bucket.count }))}
        unit="명"
        xAxisLabel="지역"
        height={200}
      />
      <Link to={ADMIN_PATHS.userStats} className="adm-button adm-button--ghost adm-button--small">
        회원 통계 열기
      </Link>
    </>
  );
}
