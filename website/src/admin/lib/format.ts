/**
 * 관리자 화면의 숫자 · 날짜 · 가림 표기. 한 곳에서 정해 화면마다 모양이 갈리지 않게 한다.
 * "@/" 별칭 없이 써서 node 테스트가 바로 읽는다.
 */

const numberFormat = new Intl.NumberFormat("ko-KR");

export const formatNumber = (value: number): string => numberFormat.format(value);

const pad = (value: number) => String(value).padStart(2, "0");

// 끝에 Z 나 ±hh:mm 이 있으면 시간대가 적힌 값이다.
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * 서버 시각을 밀리초로. 서버는 UTC 를 시간대 표기 없이 보낸다(웹 authApi 의 parseBackendTimestamp 와 같은 규칙).
 * 마이크로초는 브라우저마다 읽는 법이 달라 밀리초까지만 쓴다.
 */
export function parseServerTime(value: string): number | undefined {
  const trimmed = value.trim().replace(/(\.\d{3})\d+/, "$1");
  const time = Date.parse(TIMEZONE_SUFFIX.test(trimmed) ? trimmed : `${trimmed}Z`);
  return Number.isNaN(time) ? undefined : time;
}

function toDate(value: string | number | null | undefined): Date | null {
  if (value == null) return null;
  const time = typeof value === "number" ? value : parseServerTime(value);
  return time === undefined ? null : new Date(time);
}

/** 2026-11-10 */
export function formatDate(value: string | number | null | undefined): string {
  const date = toDate(value);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : "—";
}

/** 2026-11-10 14:32 */
export function formatDateTime(value: string | number | null | undefined): string {
  const date = toDate(value);
  return date ? `${formatDate(date.getTime())} ${pad(date.getHours())}:${pad(date.getMinutes())}` : "—";
}

/** 14:32 */
export function formatClock(value: number): string {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 목록용 이메일. 앞 두 글자와 도메인만 남긴다 — minsoo@escape.com → mi***@escape.com
 * 서버가 이미 가려 보낸 값(* 포함)은 그대로 둔다 — 두 번 가리면 글자가 더 깎인다.
 */
export function maskEmail(email: string): string {
  if (email.includes("*")) return email;
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const keep = local.length > 2 ? 2 : 1;
  return `${local.slice(0, keep)}***${email.slice(at)}`;
}

/** IP 뒷자리를 가린다 — 203.0.113.42 → 203.0.113.*** */
export function maskIp(ip: string): string {
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}:****`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.***` : "***";
}

export type DeltaTone = "good" | "bad" | "flat";

/**
 * 증감 표기. 색은 방향이 아니라 의미로 정한다 — 이탈률이 오르면 나빠진 것이다.
 * 색만 보고 못 읽는 사람을 위해 ▲▼ 와 부호를 같이 붙인다.
 */
export function formatDelta(percent: number, higherIsBetter: boolean): { text: string; tone: DeltaTone } {
  if (percent === 0) return { text: "– 0%", tone: "flat" };
  const rising = percent > 0;
  const text = `${rising ? "▲ +" : "▼ −"}${Math.abs(percent).toFixed(1)}%`;
  return { text, tone: rising === higherIsBetter ? "good" : "bad" };
}

/** 전체 대비 백분율(소수 한 자리). 전체가 0 이면 0 */
export const percent = (part: number, whole: number): number => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
