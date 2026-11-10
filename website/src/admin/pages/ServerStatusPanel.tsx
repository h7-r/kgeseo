import { checkPlatformHealth, type ServiceCheck } from "../api/health";
import { useAdminResource } from "../api/useAdminResource";
import { formatClock } from "../lib/format";
import Badge from "../ui/Badge";
import Panel from "../ui/Panel";

interface Tile {
  name: string;
  check: ServiceCheck | null;
  /** 아직 잴 수단이 없는 칸의 설명 */
  pendingNote?: string;
}

function StatusTile({ name, check, pendingNote }: Tile) {
  const badge =
    check === null ? (
      <Badge tone="gray">준비 중</Badge>
    ) : check.status === "up" ? (
      <Badge tone="blue">정상</Badge>
    ) : check.status === "down" ? (
      <Badge tone="red">응답 없음</Badge>
    ) : (
      <Badge tone="gray">확인 불가</Badge>
    );
  const detail =
    check === null
      ? pendingNote
      : check.status === "unknown"
        ? "API 가 응답하지 않아 확인할 수 없습니다"
        : `${check.latencyMs === null ? "응답 없음" : `응답 ${check.latencyMs}ms`} · ${formatClock(check.checkedAt)} 확인`;
  return (
    <div className="adm-service">
      <div className="adm-service__head">
        <span className="adm-service__name">{name}</span>
        {badge}
      </div>
      <p className="adm-service__detail">{detail}</p>
    </div>
  );
}

/** 서버 상태. API · DB 는 실제로 묻고, 로비 · 에셋은 잴 수단이 생길 때까지 준비 중으로 둔다. */
export default function ServerStatusPanel() {
  const [resource, retry] = useAdminResource("health", checkPlatformHealth);
  const health = resource.status === "ready" ? resource.data : null;

  return (
    <Panel
      title="서버 상태"
      meta={health ? `${formatClock(health.api.checkedAt)} 기준` : "확인 중"}
      actions={
        <button type="button" className="adm-button adm-button--ghost" onClick={retry} disabled={!health}>
          다시 확인
        </button>
      }
    >
      <div className="adm-grid adm-grid--four">
        <StatusTile name="API" check={health?.api ?? null} pendingNote="확인하는 중…" />
        <StatusTile name="DB" check={health?.database ?? null} pendingNote="확인하는 중…" />
        <StatusTile name="로비(실시간)" check={null} pendingNote="로비 상태 확인 수단 연결 전" />
        <StatusTile name="에셋(CDN)" check={null} pendingNote="CDN 상태 확인 수단 연결 전" />
      </div>
    </Panel>
  );
}
