import { Link } from "react-router-dom";

import { formatDelta, formatNumber, maskIp } from "../lib/format";
import { changePercent, isSpike } from "../lib/spike";
import { ADMIN_PATHS } from "../paths";
import type { PreviewData } from "../preview/types";
import { usePreviewData } from "../preview/usePreview";
import Badge from "../ui/Badge";
import BarChart from "../ui/BarChart";
import DataTable from "../ui/DataTable";
import LineChart from "../ui/LineChart";
import Panel from "../ui/Panel";
import StatCard from "../ui/StatCard";

type Security = PreviewData["security"];

/** 급증이면 레드 ▲, 아니면 회색 「평소 수준」. 색만으로 읽지 않게 글자를 같이 쓴다. */
function ChangeBadge({ value, baseline }: { value: number; baseline: number }) {
  if (!isSpike(value, baseline)) return <Badge tone="gray">평소 수준</Badge>;
  const percent = changePercent(value, baseline);
  return <Badge tone="red">{percent === null ? "▲ 새로 생김" : `${formatDelta(percent, false).text} 급증`}</Badge>;
}

/**
 * 보안 이상 신호. 서버 집계(/admin/security/*)가 생기기 전에는 라우트가 「준비 중」으로 막고, 이 화면은 미리보기에서만 그린다.
 * 원문 · 비밀번호 · 전체 IP 는 데이터로도 받지 않는다는 전제다. IP 는 화면에서 한 번 더 가린다.
 */
export default function SecurityPage() {
  const data = usePreviewData()?.security;
  if (!data) return null;

  return (
    <>
      <div className="adm-grid adm-grid--four">
        {data.totals.map((total) => {
          const spike = isSpike(total.value, total.baseline);
          const percent = changePercent(total.value, total.baseline);
          return (
            <StatCard
              key={total.label}
              label={total.label}
              value={formatNumber(total.value)}
              unit={total.unit}
              caption={`최근 24시간 · 평소 ${formatNumber(total.baseline)}${total.unit}`}
              delta={spike && percent !== null ? formatDelta(percent, false) : undefined}
              isAlert={spike}
            />
          );
        })}
      </div>

      <div className="adm-grid adm-grid--two">
        <Panel title="로그인 실패 추이" meta="최근 24시간 · 1시간 단위 · 회색 점선은 지난 7일 평균">
          <LineChart
            label="최근 24시간 시간별 로그인 실패"
            series={{ name: "오늘", points: data.loginFailures24h }}
            compare={{ name: "7일 평균", points: data.loginFailuresBaseline }}
            unit="건"
            xAxisLabel="시각"
          />
        </Panel>
        <Panel title="실패가 몰린 IP" meta="최근 24시간 · 뒷자리 가림">
          <HotIps rows={data.hotIps} />
        </Panel>
      </div>

      <div className="adm-grid adm-grid--two">
        <Panel title="API 별 너무 잦은 요청(429)" meta="최근 24시간 · 건">
          <BarChart label="API 별 429 응답 수" bars={data.rateLimited} unit="건" xAxisLabel="API" />
        </Panel>
        <Panel title="채팅 거절 사유" meta="최근 24시간 · 건 · 원문은 보이지 않음">
          <BarChart label="NPC 채팅 거절 사유별 수" bars={data.chatRejections} unit="건" xAxisLabel="거절 사유" />
        </Panel>
      </div>

      <div className="adm-grid adm-grid--two">
        <Panel title="요청 오류" meta="최근 24시간 · 평소 = 지난 7일 하루 평균">
          <DataTable
            caption="요청 오류 종류별 수"
            rows={data.requestErrors}
            rowKey={(row) => row.kind}
            emptyText="오류가 없습니다."
            minWidth={0}
            columns={[
              { key: "kind", header: "종류", render: (row) => row.kind },
              {
                key: "value",
                header: "24시간",
                align: "end",
                mono: true,
                width: "80px",
                render: (row) => formatNumber(row.value),
              },
              {
                key: "baseline",
                header: "평소",
                align: "end",
                mono: true,
                width: "72px",
                render: (row) => <span className="adm-muted">{formatNumber(row.baseline)}</span>,
              },
              {
                key: "change",
                header: "변화",
                width: "176px",
                render: (row) => <ChangeBadge value={row.value} baseline={row.baseline} />,
              },
            ]}
          />
        </Panel>
        <Panel title="관리자 로그인" meta="최근 7일 · 처음 보는 IP 는 레드">
          <AdminLogins rows={data.adminLogins} />
        </Panel>
      </div>

      <div className="adm-grid adm-grid--two">
        <Panel
          title="관리자 열람 · 변경"
          meta="최근 24시간"
          actions={
            <Link to={ADMIN_PATHS.activity} className="adm-button adm-button--ghost adm-button--small">
              활동 로그에서 자세히
            </Link>
          }
        >
          <DataTable
            caption="관리자 열람 · 변경 횟수"
            rows={data.adminActions}
            rowKey={(row) => row.action}
            emptyText="기록이 없습니다."
            minWidth={0}
            columns={[
              { key: "action", header: "한 일", render: (row) => row.action },
              { key: "count", header: "횟수", align: "end", mono: true, render: (row) => formatNumber(row.count) },
            ]}
          />
        </Panel>
        <Panel title="의존성 점검" meta="알려진 취약점 수 · 높음은 레드">
          <DependencyAudit rows={data.dependencyAudit} />
        </Panel>
      </div>
    </>
  );
}

function HotIps({ rows }: { rows: Security["hotIps"] }) {
  return (
    <DataTable
      caption="로그인 실패가 몰린 IP"
      rows={rows}
      rowKey={(row) => row.ip}
      emptyText="몰린 IP 가 없습니다."
      minWidth={0}
      columns={[
        { key: "ip", header: "IP", mono: true, truncate: (row) => maskIp(row.ip), render: (row) => maskIp(row.ip) },
        {
          key: "failures",
          header: "실패",
          align: "end",
          mono: true,
          width: "72px",
          render: (row) => formatNumber(row.failures),
        },
        {
          key: "state",
          header: "상태",
          width: "88px",
          render: (row) => (row.locked ? <Badge tone="red">잠김</Badge> : <Badge tone="gray">지켜봄</Badge>),
        },
        { key: "last", header: "마지막", mono: true, width: "160px", render: (row) => row.lastAt },
      ]}
    />
  );
}

function AdminLogins({ rows }: { rows: Security["adminLogins"] }) {
  return (
    <DataTable
      caption="관리자 로그인 기록"
      rows={rows}
      rowKey={(row) => `${row.at}-${row.admin}`}
      emptyText="관리자 로그인이 없습니다."
      minWidth={0}
      columns={[
        { key: "at", header: "시각", mono: true, width: "160px", render: (row) => row.at },
        { key: "admin", header: "관리자", truncate: (row) => row.admin, render: (row) => row.admin },
        { key: "ip", header: "IP", mono: true, width: "136px", render: (row) => maskIp(row.ip) },
        {
          key: "known",
          header: "구분",
          width: "120px",
          render: (row) =>
            row.isNewIp ? <Badge tone="red">▲ 처음 보는 IP</Badge> : <Badge tone="gray">알던 IP</Badge>,
        },
      ]}
    />
  );
}

function DependencyAudit({ rows }: { rows: Security["dependencyAudit"] }) {
  return (
    <DataTable
      caption="의존성 점검 결과"
      rows={rows}
      rowKey={(row) => row.tool}
      emptyText="점검 기록이 없습니다."
      minWidth={0}
      columns={[
        { key: "tool", header: "점검", truncate: (row) => row.tool, render: (row) => row.tool },
        { key: "date", header: "점검일", mono: true, width: "112px", render: (row) => row.checkedAt },
        {
          key: "high",
          header: "높음",
          align: "end",
          width: "72px",
          render: (row) => (row.high > 0 ? <Badge tone="red">{formatNumber(row.high)}</Badge> : "0"),
        },
        {
          key: "moderate",
          header: "보통",
          align: "end",
          mono: true,
          width: "64px",
          render: (row) => formatNumber(row.moderate),
        },
        { key: "low", header: "낮음", align: "end", mono: true, width: "64px", render: (row) => formatNumber(row.low) },
      ]}
    />
  );
}
