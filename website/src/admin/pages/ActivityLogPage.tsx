import { formatNumber } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import { usePreviewData } from "../preview/usePreview";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import PageHeader from "../ui/PageHeader";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";
import { PendingScreen } from "../ui/StatusScreen";

const LEVELS = [
  { id: "all", label: "전체" },
  { id: "INFO", label: "INFO" },
  { id: "WARN", label: "WARN" },
  { id: "ERROR", label: "ERROR" },
] as const;

/** 경고 · 오류는 레드, 보통 기록은 회색. 글자(레벨 이름)를 함께 써 색만으로 읽지 않게 한다. */
const levelTone = (level: string) => (level === "INFO" ? "gray" : "red");

export default function ActivityLogPage() {
  const data = usePreviewData()?.activity;
  const [level, setLevel] = useQueryChoice("level", LEVELS, "all");
  const logs = data?.logs.filter((log) => level === "all" || log.level === level) ?? [];

  return (
    <>
      <PageHeader title="활동 로그" description="관리자가 무엇을 열람하고 바꿨는지, 서버 경고를 봅니다." />
      {!data ? (
        <PendingScreen needs="관리자 기록(admin_audit_logs) 조회 API 가 생기면 열립니다. 기록 자체는 지금도 서버에 쌓이고 있습니다." />
      ) : (
        <>
          <div className="adm-grid adm-grid--four">
            <StatCard label="전체 기록" value={formatNumber(data.totals.all)} unit="건" caption="최근 30일" />
            <StatCard
              label="경고"
              value={formatNumber(data.totals.warn)}
              unit="건"
              caption="최근 30일"
              isAlert={data.totals.warn > 0}
            />
            <StatCard
              label="오류"
              value={formatNumber(data.totals.error)}
              unit="건"
              caption="최근 30일"
              isAlert={data.totals.error > 0}
            />
            <StatCard
              label="심각"
              value={formatNumber(data.totals.critical)}
              unit="건"
              caption="최근 30일"
              isAlert={data.totals.critical > 0}
            />
          </div>
          <Panel title="기록" actions={<PillTabs label="레벨" items={LEVELS} activeId={level} onSelect={setLevel} />}>
            <DataTable
              caption="활동 기록"
              rows={logs}
              rowKey={(row) => row.id}
              emptyText="이 레벨의 기록이 없습니다."
              columns={[
                { key: "id", header: "기록 ID", mono: true, width: "112px", render: (row) => row.id },
                { key: "at", header: "시각", mono: true, width: "168px", render: (row) => row.at },
                { key: "admin", header: "누가", width: "148px", render: (row) => row.admin },
                { key: "action", header: "무엇을", truncate: (row) => row.action, render: (row) => row.action },
                { key: "target", header: "대상", width: "120px", render: (row) => row.target },
                {
                  key: "level",
                  header: "레벨",
                  width: "96px",
                  render: (row) => <Badge tone={levelTone(row.level)}>{row.level}</Badge>,
                },
              ]}
            />
          </Panel>
        </>
      )}
    </>
  );
}
