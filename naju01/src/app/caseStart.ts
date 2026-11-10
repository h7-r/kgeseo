/** 나주 시작 카드(CaseStartCard)의 모드 · 평가 시안 설정 — 카드 파일이 컴포넌트만 내보내게 따로 둔다 */
export type CaseStartMode = "full" | "resume" | "guide";
/** 평가 영역 시안 — off(운영) · on(별 기준) · rank(+ 시간 순위 한 줄) */
export type RatingPreview = "off" | "on" | "rank";

const RATING_PARAM = typeof location !== "undefined" ? new URLSearchParams(location.search).get("rating") : null;
/** 평가(별 · 시간 · 도움 요청)는 아직 판정 · 기록 · 결과 화면이 없어 운영에서는 숨긴다 — ?rating=on · ?rating=rank 로 시안만 */
export const RATING_PREVIEW: RatingPreview = RATING_PARAM === "on" || RATING_PARAM === "rank" ? RATING_PARAM : "off";

/** 개발 서버 시안 전용 — ?card=full · resume · cleared 로 저장과 상관없이 그 카드를 띄운다(배포 빌드에서는 빠진다) */
const CARD_PARAM = typeof location !== "undefined" ? new URLSearchParams(location.search).get("card") : null;
export const CARD_PREVIEW: "full" | "resume" | "cleared" | null =
  import.meta.env.DEV && (CARD_PARAM === "full" || CARD_PARAM === "resume" || CARD_PARAM === "cleared") ? CARD_PARAM : null;
