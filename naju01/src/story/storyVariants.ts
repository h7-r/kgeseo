/**
 * 연출 · 대본 정리(11/11) 확인용 스위치 — Claude 와 Codex 의 안이 갈린 두 곳을 미르가 화면에서 견줘 보고 정한다.
 * 개발 서버에서만 주소로 바꾼다(배포 빌드는 늘 기본값). 정해지면 이 파일과 갈래를 지운다.
 *   ?rain=why     기우제의 까닭을 어부 · 동행이 말한다(Claude 안 — 지어낸 풍습이라 이야기팀 승인 필요). 기본 neutral(Codex 안 — 까닭을 지어내지 않는다)
 *   ?death=soft   아랑사의 죽음을 「속아 … 떨어졌다」로(중간안). 기본 source(원전 문장 「속여 … 떨어뜨려 죽였다」)
 * React · 별칭을 쓰지 않는다(node --test).
 */
const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
const query = isDev && typeof location !== "undefined" ? new URLSearchParams(location.search) : null;

export const RAIN_REASON: "why" | "neutral" = query?.get("rain") === "why" ? "why" : "neutral";
export const DEATH_WORDING: "source" | "soft" = query?.get("death") === "soft" ? "soft" : "source";
