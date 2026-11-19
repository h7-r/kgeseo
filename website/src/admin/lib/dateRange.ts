/**
 * 달력 기간 고르기의 셈 — 한국 날짜(YYYY-MM-DD) 문자열만 다룬다. "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 * 브라우저 시간대와 상관없이 KST 로 센다(lib/auditLog.kstDate 와 같은 규칙).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const isIsoDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** "2026-11-12" → 그날 00:00 UTC 의 밀리초(날짜 셈용 — 시간대 없는 달력 산수) */
export const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export const isoOf = (dayMs: number): string => new Date(dayMs).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string => isoOf(dayNumber(iso) + days * DAY_MS);

/** 양 끝 포함 일수 */
export const spanDays = (from: string, to: string): number =>
  Math.round((dayNumber(to) - dayNumber(from)) / DAY_MS) + 1;

export const todayKst = (now = Date.now()): string => new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);

export interface DateRange {
  from: string;
  to: string;
}

/**
 * 기간이 쓸 만한지 — 둘 다 날짜이고 from ≤ to 이고 오늘(KST)을 넘지 않고 maxDays 안.
 * 서버(§3.4)가 같은 규칙으로 다시 보지만, 화면에서 먼저 막아 422 를 피한다.
 */
export function validateRange(range: DateRange, maxDays: number, now = Date.now()): string | null {
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) return "날짜 모양이 맞지 않습니다.";
  if (range.from > range.to) return "시작일이 끝일보다 늦습니다.";
  if (range.to > todayKst(now)) return "오늘(한국 시각)까지만 고를 수 있습니다.";
  if (spanDays(range.from, range.to) > maxDays) return `한 번에 ${maxDays}일까지만 볼 수 있습니다.`;
  return null;
}

export interface CalendarCell {
  iso: string;
  /** 그 달 바깥 날(앞뒤 채움) */
  isOutside: boolean;
}

/** 달력 한 달 — 일요일 시작, 6줄 42칸 */
export function calendarCells(year: number, month: number): CalendarCell[] {
  const first = Date.UTC(year, month - 1, 1);
  const lead = new Date(first).getUTCDay();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const dayMs = first + (i - lead) * DAY_MS;
    cells.push({ iso: isoOf(dayMs), isOutside: new Date(dayMs).getUTCMonth() !== month - 1 });
  }
  return cells;
}

export const monthLabel = (year: number, month: number): string => `${year}년 ${month}월`;

/** "2026-11-12" → { year: 2026, month: 11 } */
export function yearMonthOf(iso: string): { year: number; month: number } {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

export function shiftMonth(year: number, month: number, step: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + step;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 지난달 대비 % — 분모가 0 이면 null(「새로 생김」) */
export const changePercentOf = (current: number, previous: number): number | null =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
