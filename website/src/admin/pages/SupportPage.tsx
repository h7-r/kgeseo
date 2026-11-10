import { formatNumber } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import type { PreviewData } from "../preview/types";
import { usePreviewData } from "../preview/usePreview";
import Badge, { type BadgeTone } from "../ui/Badge";
import DataTable from "../ui/DataTable";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import StatCard from "../ui/StatCard";

type Inquiry = PreviewData["inquiries"]["rows"][number];

const FILTERS = [
  { id: "all", label: "전체" },
  { id: "open", label: "미답변" },
  { id: "done", label: "답변 완료" },
  { id: "urgent", label: "긴급" },
] as const;

const MATCHES: Record<(typeof FILTERS)[number]["id"], (row: Inquiry) => boolean> = {
  all: () => true,
  open: (row) => row.status === "미답변",
  done: (row) => row.status === "답변 완료",
  urgent: (row) => row.priority === "긴급",
};

const STATUS_TONE: Record<Inquiry["status"], BadgeTone> = { 미답변: "red", 처리중: "gray", "답변 완료": "blue" };

/** 문의 유형은 웹 FAQ 분류(계정 · 게임플레이 · 결제 · 기술지원)를 따른다. 담당자는 관리자 닉네임이다. */
export default function SupportPage() {
  const data = usePreviewData()?.inquiries;
  const [filter, setFilter] = useQueryChoice("filter", FILTERS, "all");
  const rows = data?.rows.filter(MATCHES[filter]) ?? [];

  if (!data) return null;

  return (
    <>
      <div className="adm-grid adm-grid--four">
        <StatCard label="전체 문의" value={formatNumber(data.stats.total)} unit="건" caption="누적" />
        <StatCard
          label="미답변"
          value={formatNumber(data.stats.open)}
          unit="건"
          caption="답변 대기"
          isAlert={data.stats.open > 0}
        />
        <StatCard label="오늘 접수" value={formatNumber(data.stats.today)} unit="건" caption="오늘 0시부터" />
        <StatCard
          label="평균 응답 시간"
          value={data.stats.avgResponseHours.toFixed(1)}
          unit="시간"
          caption="최근 7일"
        />
      </div>
      <Panel
        title="문의 목록"
        actions={<PillTabs label="문의 상태" items={FILTERS} activeId={filter} onSelect={setFilter} />}
      >
        <DataTable
          caption="문의 목록"
          rows={rows}
          rowKey={(row) => row.id}
          emptyText="이 조건의 문의가 없습니다."
          columns={[
            { key: "id", header: "문의 ID", mono: true, width: "96px", render: (row) => row.id },
            { key: "title", header: "제목", truncate: (row) => row.title, render: (row) => row.title },
            {
              key: "nickname",
              header: "회원",
              width: "128px",
              truncate: (row) => row.nickname,
              render: (row) => row.nickname,
            },
            { key: "category", header: "유형", width: "104px", render: (row) => row.category },
            {
              key: "status",
              header: "상태",
              width: "104px",
              render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
            },
            {
              key: "priority",
              header: "우선순위",
              width: "96px",
              render: (row) => (row.priority === "긴급" ? <Badge tone="red">긴급</Badge> : row.priority),
            },
            { key: "received", header: "접수 시각", mono: true, width: "168px", render: (row) => row.receivedAt },
            { key: "assignee", header: "담당자", width: "120px", render: (row) => row.assignee },
          ]}
        />
      </Panel>
    </>
  );
}
