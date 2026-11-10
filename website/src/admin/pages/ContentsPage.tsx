import { useQueryChoice } from "../lib/useQueryChoice";
import { usePreviewData } from "../preview/usePreview";
import Badge from "../ui/Badge";
import Panel from "../ui/Panel";
import PillTabs from "../ui/PillTabs";

const KINDS = [
  { id: "all", label: "전체" },
  { id: "홈 영상", label: "홈 영상" },
  { id: "미디어", label: "미디어" },
  { id: "게임 콘텐츠", label: "게임 콘텐츠" },
] as const;

/** 웹 홈 영상 · 미디어와 게임 콘텐츠 판(naju-angam-01 v1 등)의 게시 상태. */
export default function ContentsPage() {
  const contents = usePreviewData()?.contents;
  const [kind, setKind] = useQueryChoice("kind", KINDS, "all");
  const items = contents?.filter((item) => kind === "all" || item.kind === kind) ?? [];

  if (!contents) return null;

  return (
    <Panel title="콘텐츠 목록" actions={<PillTabs label="종류" items={KINDS} activeId={kind} onSelect={setKind} />}>
      {items.length === 0 ? (
        <p className="adm-muted">이 종류의 콘텐츠가 없습니다.</p>
      ) : (
        <ul className="adm-cards">
          {items.map((item) => (
            <li key={item.id} className="adm-content-card">
              <div className="adm-content-card__thumb">
                {item.poster ? <img src={item.poster} alt="" loading="lazy" /> : <span>미리보기 없음</span>}
              </div>
              <div className="adm-content-card__body">
                <span className="adm-content-card__id">{item.id}</span>
                <p className="adm-content-card__title" title={item.title}>
                  {item.title}
                </p>
                <div className="adm-content-card__meta">
                  <span>{item.kind}</span>
                  <Badge tone={item.status === "게시중" ? "blue" : "gray"}>{item.status}</Badge>
                </div>
                <span className="adm-content-card__date">수정 {item.updatedAt}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
