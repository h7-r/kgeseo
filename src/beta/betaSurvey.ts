/**
 * 베타 설문 연결 — 참여 코드가 미리 채워진 구글 폼 주소를 만들고, 띄움(shown) · 엶(opened)을 기록한다(L19).
 *
 * 폼 주소는 구글 폼의 「미리 채운 링크 가져오기」로 만든 주소에서 참여 코드 칸 값을 `{pc}` 로 바꿔 넣는다.
 * (예: https://docs.google.com/forms/d/e/…/viewform?usp=pp_url&entry.123456={pc})
 * 빌드 변수(VITE_BETA_FORM_*)가 있으면 그것을, 없으면 아래 BETA_FORMS 를 쓴다. 비어 있으면 그 설문 안내는 뜨지 않는다.
 * 끝난 뒤 설문은 보상 질문 두 개(D3 · D4)의 순서만 다른 두 판(A · B)을 두고, 참여 코드로 반씩 나눈다.
 */
import { betaLog } from "./betaLog";

export type SurveyKind = "pre" | "post" | "exit";

/** 폼 주소 — 미르 · 설문 담당이 채운다(빌드 변수가 우선) */
export const BETA_FORMS = {
  pre: "",
  /** D3(코스튬) → D4(할인권) */
  postA: "",
  /** D4(할인권) → D3(코스튬) */
  postB: "",
  exit: "",
};

function envForm(name: string): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env[name] ?? "").trim();
}

/** 참여 코드로 고정된 반(A · B) — 같은 사람은 늘 같은 판 */
export function postVariant(pc: string): "A" | "B" {
  let hash = 0;
  for (const char of pc) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 2 === 0 ? "A" : "B";
}

function template(kind: SurveyKind, pc: string): { url: string; variant: string | null } {
  if (kind === "pre") return { url: envForm("VITE_BETA_FORM_PRE") || BETA_FORMS.pre, variant: null };
  if (kind === "exit") return { url: envForm("VITE_BETA_FORM_EXIT") || BETA_FORMS.exit, variant: null };
  const variant = postVariant(pc);
  const url =
    variant === "A"
      ? envForm("VITE_BETA_FORM_POST_A") || BETA_FORMS.postA
      : envForm("VITE_BETA_FORM_POST_B") || BETA_FORMS.postB;
  return { url, variant };
}

/** 이 사람에게 띄울 설문 주소. 참여 코드가 없거나 주소가 비었으면 null */
export function surveyLink(kind: SurveyKind): { url: string; variant: string | null } | null {
  const pc = betaLog.participantCode();
  if (!betaLog.isActive() || !pc) return null;
  const { url, variant } = template(kind, pc);
  if (!url || !url.startsWith("https://")) return null;
  const run = betaLog.run();
  return {
    url: url
      .replaceAll("{pc}", encodeURIComponent(pc))
      .replaceAll("{run}", encodeURIComponent(run ? String(run.index) : "")),
    variant,
  };
}

/** 이 설문을 이미 처리했나(엶 · 「이미 했어요」) — 끝난 뒤 · 중단 설문은 회차마다 */
const doneKey = (kind: SurveyKind) => {
  // 시작 전은 참여 코드마다(한 PC 를 여러 참가자가 쓰면 각자 묻는다), 끝난 뒤 · 중단은 회차마다
  if (kind === "pre") return `waegok.beta.survey.pre.${betaLog.participantCode() ?? ""}`;
  const run = betaLog.run();
  return `waegok.beta.survey.${kind}${run ? `.${run.id}` : ""}`;
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
