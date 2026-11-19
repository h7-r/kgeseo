import type { DeltaTone } from "../lib/format";

interface StatCardProps {
  label: string;
  /** null 이면 서버 값이 아직 없다는 뜻이다. 0 과 구분한다. */
  value: string | null;
  /** value 가 null 일 때 캡션 자리에 보일 말. 서버에 원천이 없는 지표는 「준비 중 — …」으로 까닭을 적는다. */
  pendingText?: string;
  unit?: string;
  caption: string;
  delta?: { text: string; tone: DeltaTone };
  /** 미답변 · 경고 · 오류처럼 0 이 아니면 살펴야 하는 숫자 — 레드로 보인다 */
  isAlert?: boolean;
  /** 있으면 카드가 단추가 되어 누르면 상세(가운데 창)를 연다. 값이 없는 카드는 눌리지 않는다 */
  onOpen?: () => void;
}

/** 큰 숫자 하나. 숫자는 한 줄로 두고 넘치면 말줄임 — 두 줄로 깨지지 않게. */
export default function StatCard({
  label,
  value,
  pendingText = "서버 연결 전",
  unit,
  caption,
  delta,
  isAlert,
  onOpen,
}: StatCardProps) {
  const full = value === null ? pendingText : `${value}${unit ?? ""}`;
  const body = (
    <>
      <div className="adm-stat__head">
        <span className="adm-stat__label">{label}</span>
        {delta && <span className={`adm-delta adm-delta--${delta.tone}`}>{delta.text}</span>}
        {onOpen && value !== null && !delta && <span className="adm-stat__more">자세히 ›</span>}
      </div>
      <p className={`adm-stat__value${value === null ? " is-pending" : isAlert ? " is-alert" : ""}`} title={full}>
        {value ?? "—"}
        {value !== null && unit && <span className="adm-stat__unit">{unit}</span>}
      </p>
      <span className="adm-stat__caption">{value === null ? pendingText : caption}</span>
    </>
  );
  if (onOpen && value !== null)
    return (
      <button type="button" className="adm-stat adm-stat--button" onClick={onOpen} aria-label={`${label} 자세히 보기`}>
        {body}
      </button>
    );
  return <div className="adm-stat">{body}</div>;
}
