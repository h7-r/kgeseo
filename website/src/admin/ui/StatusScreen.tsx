import type { ReactNode } from "react";

export type StatusKind = "pending" | "loading" | "empty" | "error" | "forbidden" | "notFound";

interface StatusScreenProps {
  kind: StatusKind;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** 카드 안에 들어가는 작은 판 */
  compact?: boolean;
}

const MARK: Record<StatusKind, string> = {
  pending: "준비 중",
  loading: "불러오는 중",
  empty: "비어 있음",
  error: "오류",
  forbidden: "권한 없음",
  notFound: "없음",
};

/** 빈 상태 · 불러오는 중 · 오류 · 권한 없음을 한 모양으로 그린다. */
export default function StatusScreen({ kind, title, description, action, compact }: StatusScreenProps) {
  const isAlert = kind === "error" || kind === "forbidden";
  return (
    <div
      className={`adm-status adm-status--${kind}${compact ? " is-compact" : ""}`}
      role={isAlert ? "alert" : "status"}
      aria-busy={kind === "loading" || undefined}
    >
      <span className="adm-status__mark">{MARK[kind]}</span>
      <p className="adm-status__title">{title}</p>
      {description && <p className="adm-status__desc">{description}</p>}
      {action && <div className="adm-status__action">{action}</div>}
    </div>
  );
}

/** 서버 API 가 아직 없는 화면. 무엇이 생기면 열리는지 적는다. */
export function PendingScreen({ needs, compact }: { needs: string; compact?: boolean }) {
  return <StatusScreen kind="pending" title="서버 연결 전 — 준비 중" description={needs} compact={compact} />;
}
