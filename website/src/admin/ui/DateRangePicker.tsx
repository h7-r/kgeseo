import { useEffect, useRef, useState } from "react";

import {
  calendarCells,
  monthLabel,
  shiftMonth,
  todayKst,
  validateRange,
  yearMonthOf,
  type DateRange,
} from "../lib/dateRange";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface DateRangePickerProps {
  value: DateRange;
  /** 한 번에 볼 수 있는 최대 일수(서버 규칙) */
  maxDays: number;
  onApply: (range: DateRange) => void;
}

/**
 * 작은 달력 창으로 기간을 고른다. 단추를 누르면 달력이 뜨고, 시작일 → 끝일 순서로 두 번 누른 뒤 「적용」.
 * 직접 쳐 넣는 칸도 둔다(키보드 · 날짜를 아는 사람). 오늘(KST) 뒤 날짜는 누를 수 없다.
 */
export default function DateRangePicker({ value, maxDays, onApply }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const [picking, setPicking] = useState<"from" | "to">("from");
  const [view, setView] = useState(() => yearMonthOf(value.to));
  const popRef = useRef<HTMLDivElement>(null);
  const today = todayKst();
  const error = validateRange(draft, maxDays);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const open = () => {
    setDraft(value);
    setPicking("from");
    setView(yearMonthOf(value.to));
    setIsOpen(true);
  };

  const pick = (iso: string) => {
    if (iso > today) return;
    if (picking === "from" || iso < draft.from) {
      setDraft({ from: iso, to: iso });
      setPicking("to");
    } else {
      setDraft({ from: draft.from, to: iso });
      setPicking("from");
    }
  };

  const apply = () => {
    if (error) return;
    onApply(draft);
    setIsOpen(false);
  };

  const cells = calendarCells(view.year, view.month);

  return (
    <div className="adm-daterange" ref={popRef}>
      <button
        type="button"
        className="adm-button adm-button--ghost adm-daterange__button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={isOpen ? () => setIsOpen(false) : open}
      >
        <CalendarIcon />
        <span className="adm-mono">
          {value.from} ~ {value.to}
        </span>
      </button>
      {isOpen && (
        <div className="adm-daterange__pop" role="dialog" aria-label="기간 고르기">
          <div className="adm-daterange__inputs">
            <label className="adm-daterange__field">
              <span>시작일</span>
              <input
                className="adm-input adm-mono"
                type="date"
                max={today}
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            </label>
            <label className="adm-daterange__field">
              <span>끝일</span>
              <input
                className="adm-input adm-mono"
                type="date"
                max={today}
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </label>
          </div>
          <div className="adm-calendar">
            <div className="adm-calendar__head">
              <button
                type="button"
                className="adm-button adm-button--ghost adm-button--small"
                aria-label="지난달"
                onClick={() => setView(shiftMonth(view.year, view.month, -1))}
              >
                ‹
              </button>
              <b>{monthLabel(view.year, view.month)}</b>
              <button
                type="button"
                className="adm-button adm-button--ghost adm-button--small"
                aria-label="다음달"
                onClick={() => setView(shiftMonth(view.year, view.month, 1))}
              >
                ›
              </button>
            </div>
            <div className="adm-calendar__grid" role="grid">
              {WEEKDAYS.map((day) => (
                <span key={day} className="adm-calendar__weekday" role="columnheader">
                  {day}
                </span>
              ))}
              {cells.map((cell) => {
                const isInRange = cell.iso >= draft.from && cell.iso <= draft.to;
                const isEdge = cell.iso === draft.from || cell.iso === draft.to;
                const className = [
                  "adm-calendar__day",
                  cell.isOutside && "is-outside",
                  isInRange && "is-in-range",
                  isEdge && "is-edge",
                  cell.iso === today && "is-today",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    role="gridcell"
                    className={className}
                    disabled={cell.iso > today}
                    aria-pressed={isEdge}
                    aria-label={cell.iso}
                    onClick={() => pick(cell.iso)}
                  >
                    {Number(cell.iso.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          </div>
          <p className={error ? "adm-field__error" : "adm-daterange__hint"}>
            {error ?? (picking === "to" ? "끝일을 누르세요." : `시작일을 누르세요. 한 번에 ${maxDays}일까지.`)}
          </p>
          <div className="adm-daterange__actions">
            <button
              type="button"
              className="adm-button adm-button--ghost adm-button--small"
              onClick={() => setIsOpen(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="adm-button adm-button--primary adm-button--small"
              disabled={!!error}
              onClick={apply}
            >
              적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="adm-icon">
      <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
