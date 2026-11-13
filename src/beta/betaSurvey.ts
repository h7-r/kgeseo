/**
 * 베타 설문 연결 — 따로 만든 구글 폼을 게임에서 연다(미르 11/11). 시작 전 · 끝난 뒤(결과 · 현장 방문 창보다 먼저) · 중단(멈춤 메뉴).
 * 폼에 「참가 번호」 짧은 답 칸을 두고, 「미리 채운 링크 가져오기」로 만든 주소에서 그 칸 값을 `{key}` 로 바꿔 넣는다
 * (예: https://docs.google.com/forms/d/e/…/viewform?usp=pp_url&entry.123456={key}). 게임이 계정 id 의 짧은 지문(참가 번호)을 채워
 * 폼 응답과 게임 기록을 같은 사람으로 잇는다 — 이름 · 이메일은 폼 주소에 넣지 않는다. `{run}` 은 나주 회차(0부터).
 * 빌드 변수(VITE_BETA_FORM_*)가 있으면 그것을, 없으면 아래 BETA_FORMS 를 쓴다. 비어 있으면 그 설문 안내는 뜨지 않는다.
 * 끝난 뒤 설문은 보상 질문 두 개(D3 · D4)의 순서만 다른 두 판(A · B)을 두면 참가 번호로 반씩 나눈다(B 가 비면 모두 A).
 */
import { betaLog } from "./betaLog";

export type SurveyKind = "pre" | "post" | "exit";

/**
 * 11/12 팀 폼 하나 — 끝난 뒤 · 중단이 같은 폼이다(시작 전 설문 없음 · A/B 판 없음).
 * 「참가 번호」(응답자 정보 맨 위 단답, 11/12 팀이 더함)에 참가 번호를 채우고, 6번(어디까지 하셨나요)을 미리 고른다:
 * 끝난 뒤는 「엔딩까지」, 중단(나주 멈춤 메뉴에만 있다)은 「나주 도중」. 참가자는 아무것도 적지 않는다.
 */
const TEAM_FORM =
  "https://docs.google.com/forms/d/e/1FAIpQLSd1DHDW1uBNLtLHIC4niLO9-erjkGhVQSJ8d37ssUIkknC8kw/viewform?usp=pp_url&entry.228975187={key}";
const PLAYED_TO = "entry.2031914977";

/** 폼 주소 — 미르 · 설문 담당이 채운다(빌드 변수가 우선) */
export const BETA_FORMS = {
  pre: "",
  /** D3(코스튬) → D4(할인권) */
  postA: `${TEAM_FORM}&${PLAYED_TO}=${encodeURIComponent("엔딩까지")}`,
  /** D4(할인권) → D3(코스튬) */
  postB: "",
  exit: `${TEAM_FORM}&${PLAYED_TO}=${encodeURIComponent("나주 도중")}`,
};

function envForm(name: string): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env[name] ?? "").trim();
}

/** 참여 코드로 고정된 반(A · B) — 같은 사람은 늘 같은 판 */
export function postVariant(key: string): "A" | "B" {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 2 === 0 ? "A" : "B";
}

function template(kind: SurveyKind, key: string): { url: string; variant: string | null } {
  if (kind === "pre") return { url: envForm("VITE_BETA_FORM_PRE") || BETA_FORMS.pre, variant: null };
  if (kind === "exit") return { url: envForm("VITE_BETA_FORM_EXIT") || BETA_FORMS.exit, variant: null };
  const postA = envForm("VITE_BETA_FORM_POST_A") || BETA_FORMS.postA;
  const postB = envForm("VITE_BETA_FORM_POST_B") || BETA_FORMS.postB;
  // 판이 하나뿐이면(B 없음) 모두 A
  if (!postB) return { url: postA, variant: postA ? "A" : null };
  const variant = postVariant(key);
  return { url: variant === "A" ? postA : postB, variant };
}

/** 이 사람에게 띄울 설문 주소. 계정(또는 참여 코드)을 모르거나 주소가 비었으면 null */
export function surveyLink(kind: SurveyKind): { url: string; variant: string | null } | null {
  const key = betaLog.participantKey();
  if (!betaLog.isActive() || !key) return null;
  const { url, variant } = template(kind, key);
  if (!url || !url.startsWith("https://")) return null;
  const run = betaLog.run();
  return {
    url: url
      .replaceAll("{key}", encodeURIComponent(key))
      .replaceAll("{pc}", encodeURIComponent(key))
      .replaceAll("{run}", encodeURIComponent(run ? String(run.index) : "")),
    variant,
  };
}

/**
 * 이 설문을 이미 처리했나(엶 · 「이미 했어요」) — 사람마다(한 PC 를 여러 참가자가 쓰면 각자 묻는다).
 * 끝난 뒤 · 중단은 같은 폼이고 폼이 「한 번만 응답해 주세요」라 한 자리로 센다 — 중단 설문을 연 사람에게 엔딩에서,
 * 다시 시작한 회차에서 또 묻지 않는다.
 */
const doneKey = (kind: SurveyKind) => {
  const person = betaLog.participantKey() ?? "";
  return kind === "pre" ? `waegok.beta.survey.pre.${person}` : `waegok.beta.survey.final.${person}`;
};

export function isSurveyHandled(kind: SurveyKind): boolean {
  try {
    return localStorage.getItem(doneKey(kind)) !== null;
  } catch {
    return false;
  }
}

function markHandled(kind: SurveyKind, how: string) {
  try {
    localStorage.setItem(doneKey(kind), how);
  } catch {
    /* 무시 */
  }
}

/** 지금 띄워야 하나 — 참여 코드 · 주소가 있고 아직 처리하지 않았을 때 */
export function shouldOfferSurvey(kind: SurveyKind): boolean {
  return surveyLink(kind) !== null && !isSurveyHandled(kind);
}

/** 한 페이지에서 같은 안내를 두 번 세지 않는다(개발 모드 StrictMode 의 두 번 실행 · 다시 그리기) */
const shownOnPage = new Set<string>();

export function noteSurveyShown(kind: SurveyKind, where: string) {
  const key = `${kind}|${where}`;
  if (shownOnPage.has(key)) return;
  shownOnPage.add(key);
  const link = surveyLink(kind);
  betaLog.track("survey_link", "shown", { withRun: kind !== "pre", data: { kind, where, variant: link?.variant ?? null } });
}

/** 새 창으로 연다 — 클릭 처리 안에서 바로 불러야 팝업 차단에 걸리지 않는다 */
export function openSurvey(kind: SurveyKind, where: string): boolean {
  const link = surveyLink(kind);
  if (!link) return false;
  const opened = window.open(link.url, "_blank", "noopener");
  // noopener 면 열려도 null 을 돌려주는 브라우저가 있다 — 막혔는지는 알 수 없어 연 것으로 친다
  markHandled(kind, "opened");
  betaLog.track("survey_link", "opened", {
    urgent: true,
    withRun: kind !== "pre",
    data: { kind, where, variant: link.variant, handle: opened ? "window" : "unknown" },
  });
  return true;
}

/** 「이미 했어요」 · 「나중에」 */
export function dismissSurvey(kind: SurveyKind, where: string, how: "already" | "later") {
  if (how === "already") markHandled(kind, "already");
  betaLog.track("survey_link", how === "already" ? "dismissed_done" : "dismissed_later", {
    withRun: kind !== "pre",
    data: { kind, where },
  });
}
