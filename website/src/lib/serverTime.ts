// 끝에 Z 나 ±hh:mm 이 있으면 시간대가 적힌 값이다.
const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * 서버 시각을 밀리초로. 서버는 UTC 를 시간대 표기 없이 보내는데, Date.parse 는 표기가 없으면 현지 시각으로 읽는다.
 * 표기가 없을 때만 Z 를 붙인다 — 서버가 나중에 Z 를 붙여 보내도(/me created_at) 그대로 맞다. 읽을 수 없으면 undefined.
 */
export function parseBackendTimestamp(value: string): number | undefined {
  // 마이크로초(6자리)는 브라우저마다 읽는 법이 달라 밀리초까지만 쓴다.
  const trimmed = value.trim().replace(/(\.\d{3})\d+/, "$1");
  const time = Date.parse(TIMEZONE_SUFFIX.test(trimmed) ? trimmed : `${trimmed}Z`);
  return Number.isNaN(time) ? undefined : time;
}
