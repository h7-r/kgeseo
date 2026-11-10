import { formatNumber } from "../lib/format";
import { usePreviewData } from "../preview/usePreview";
import BarChart from "../ui/BarChart";
import DataTable from "../ui/DataTable";
import LineChart from "../ui/LineChart";
import Panel from "../ui/Panel";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";
import ServerStatusPanel from "./ServerStatusPanel";

const count = (value: number | undefined) => (value === undefined ? null : formatNumber(value));

/** 1차는 서버 상태만 실제 값이다. 숫자 · 그래프는 집계 API 가 생기면 연결한다. 매출 카드는 결제 연결 전이라 두지 않는다. */
export default function DashboardPage() {
  const data = usePreviewData()?.dashboard;

  return (
    <>
      <div className="adm-grid adm-grid--stats">
        <StatCard label="동시접속자" value={count(data?.concurrent)} unit="명" caption="실시간" />
        <StatCard label="오늘 DAU" value={count(data?.dau)} unit="명" caption="오늘 0시부터" />
        <StatCard label="총 회원수" value={count(data?.totalMembers)} unit="명" caption="누적" />
        <StatCard label="오늘 신규 가입" value={count(data?.signupsToday)} unit="명" caption="오늘 0시부터" />
        <StatCard
          label="미답변 문의"
          value={count(data?.openInquiries)}
          unit="건"
          caption="답변 대기"
          isAlert={(data?.openInquiries ?? 0) > 0}
        />
      </div>

      <div className="adm-grid adm-grid--two">
        <Panel title="접속자 추이" meta="최근 7일 · 일 단위">
          {data ? (
            <LineChart
              label="최근 7일 일별 접속자"
              series={{ name: "접속자", points: data.visitors7d }}
              unit="명"
              xAxisLabel="날짜(월-일)"
            />
          ) : (
            <PendingScreen compact needs="접속 집계 API 가 생기면 열립니다." />
          )}
        </Panel>
        <Panel title="스테이지별 완료율" meta="나주 사건 · 진입 대비 완료 %">
          {data ? (
            <BarChart
              label="나주 사건 스테이지별 완료율"
              bars={data.stageCompletion}
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
        {data ? (
          <DataTable
            caption="최근 관리자 기록"
            rows={data.adminActions}
            rowKey={(row) => `${row.at}-${row.action}-${row.admin}`}
            emptyText="기록이 없습니다."
            columns={[
              { key: "at", header: "시각", mono: true, width: "180px", render: (row) => row.at },
              { key: "admin", header: "관리자", width: "160px", render: (row) => row.admin },
              { key: "action", header: "한 일", render: (row) => row.action },
              { key: "target", header: "대상", width: "200px", render: (row) => row.target },
            ]}
          />
        ) : (
          <PendingScreen compact needs="관리자 기록(admin_audit_logs) 조회 API 가 생기면 열립니다." />
        )}
      </Panel>

      <ServerStatusPanel />
    </>
  );
}
