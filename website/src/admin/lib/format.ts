import { parseBackendTimestamp } from "@/services/account/authApi";

/** 관리자 화면의 숫자 · 날짜 · 가림 표기. 한 곳에서 정해 화면마다 모양이 갈리지 않게 한다. */

const numberFormat = new Intl.NumberFormat("ko-KR");

export const formatNumber = (value: number): string => numberFormat.format(value);

const pad = (value: number) => String(value).padStart(2, "0");

function toDate(value: string | number | null | undefined): Date | null {
  if (value == null) return null;
  // 서버 시각은 UTC 를 시간대 없이 보낸다. 웹과 같은 해석기를 쓴다.
  const time = typeof value === "number" ? value : parseBackendTimestamp(value);
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

/** 목록용 이메일. 앞 두 글자와 도메인만 남긴다 — minsoo@escape.com → mi***@escape.com */
export function maskEmail(email: string): string {
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
