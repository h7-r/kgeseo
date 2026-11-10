import { formatNumber } from "../lib/format";
import { useQueryChoice } from "../lib/useQueryChoice";
import { usePreviewData } from "../preview/usePreview";
import Badge from "../ui/Badge";
import DataTable from "../ui/DataTable";
import PageHeader from "../ui/PageHeader";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";
import { PendingScreen } from "../ui/StatusScreen";

/** 분류는 웹 고객센터 공지(data/support.ts)와 같다. 인게임 공지 기능이 없어 노출 위치는 웹뿐이다. */
const CATEGORIES = [
  { id: "all", label: "전체" },
  { id: "점검", label: "점검" },
  { id: "이벤트", label: "이벤트" },
  { id: "업데이트", label: "업데이트" },
  { id: "안내", label: "안내" },
] as const;

export default function NoticesPage() {
  const notices = usePreviewData()?.notices;
  const [category, setCategory] = useQueryChoice("category", CATEGORIES, "all");
  const rows = notices?.filter((notice) => category === "all" || notice.category === category) ?? [];

  return (
    <>
      <PageHeader
        title="공지사항"
        description="웹 고객센터에 실리는 공지를 관리합니다."
        actions={
          <button type="button" className="adm-button adm-button--primary" disabled title="공지 API 연결 전">
            공지 작성
          </button>
        }
      />
      {!notices ? (
        <PendingScreen needs="공지 API 가 생기면 열립니다. 지금 웹 고객센터 공지는 코드에 고정된 글입니다." />
      ) : (
        <Panel
          title="공지 목록"
          actions={<PillTabs label="분류" items={CATEGORIES} activeId={category} onSelect={setCategory} />}
        >
          <DataTable
            caption="공지 목록"
            rows={rows}
            rowKey={(row) => row.id}
            emptyText="이 분류의 공지가 없습니다."
            columns={[
              { key: "id", header: "공지 ID", mono: true, width: "104px", render: (row) => row.id },
              { key: "title", header: "제목", truncate: (row) => row.title, render: (row) => row.title },
              {
                key: "category",
                header: "분류",
                width: "104px",
                render: (row) => <Badge tone="gray">{row.category}</Badge>,
              },
              {
                key: "status",
                header: "상태",
                width: "104px",
                render: (row) => <Badge tone={row.status === "게시중" ? "blue" : "gray"}>{row.status}</Badge>,
              },
              { key: "place", header: "노출 위치", width: "96px", render: () => "웹" },
              { key: "created", header: "작성일", mono: true, width: "120px", render: (row) => row.createdAt },
              {
                key: "views",
                header: "조회수",
                align: "end",
                mono: true,
                width: "96px",
                render: (row) => formatNumber(row.views),
              },
            ]}
          />
        </Panel>
      )}
    </>
  );
}
