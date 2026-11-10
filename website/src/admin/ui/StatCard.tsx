import type { DeltaTone } from "../lib/format";

interface StatCardProps {
  label: string;
  /** null 이면 서버 값이 아직 없다는 뜻이다. 0 과 구분한다. */
  value: string | null;
  unit?: string;
  caption: string;
  delta?: { text: string; tone: DeltaTone };
  /** 미답변 · 경고 · 오류처럼 0 이 아니면 살펴야 하는 숫자 — 레드로 보인다 */
  isAlert?: boolean;
}

/** 큰 숫자 하나. 숫자는 한 줄로 두고 넘치면 말줄임 — 두 줄로 깨지지 않게. */
export default function StatCard({ label, value, unit, caption, delta, isAlert }: StatCardProps) {
  const full = value === null ? "서버 연결 전" : `${value}${unit ?? ""}`;
  return (
    <div className="adm-stat">
      <div className="adm-stat__head">
        <span className="adm-stat__label">{label}</span>
        {delta && <span className={`adm-delta adm-delta--${delta.tone}`}>{delta.text}</span>}
      </div>
      <p className={`adm-stat__value${value === null ? " is-pending" : isAlert ? " is-alert" : ""}`} title={full}>
        {value ?? "—"}
        {value !== null && unit && <span className="adm-stat__unit">{unit}</span>}
      </p>
      <span className="adm-stat__caption">{value === null ? "서버 연결 전" : caption}</span>
    </div>
  );
}
