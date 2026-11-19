/**
 * 저장 칸(state.sections)을 관리자가 읽을 수 있게 줄인다.
 * 진행을 뜻하는 짧은 단계 이름(예: open · done)과 예/아니오만 보인다.
 * 숫자 · 목록 · 긴 글은 퍼즐 정답(번호 · 순서)이 될 수 있어 값을 숨기고 종류만 적는다.
 */
const STAGE_WORD = /^[a-z][a-zA-Z_-]{0,31}$/;

function describeScalar(value: unknown): string {
  if (value === null || value === undefined) return "없음";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "string") return STAGE_WORD.test(value) ? value : "글자 값(숨김)";
  if (typeof value === "number") return "숫자 값(숨김)";
  if (Array.isArray(value)) return `목록 ${value.length}개(숨김)`;
  return "항목 묶음";
}

export function describeSection(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return describeScalar(value);
  const entries = Object.entries(value);
  const parts = entries
    .filter(([, inner]) => typeof inner === "boolean" || (typeof inner === "string" && STAGE_WORD.test(inner)))
    .map(([key, inner]) => `${key}: ${describeScalar(inner)}`);
  const hidden = entries.length - parts.length;
  if (hidden > 0) parts.push(`그 밖 ${hidden}개(숨김)`);
  return parts.length ? parts.join(" · ") : "비어 있음";
}

export function listSections(state: Record<string, unknown> | undefined): { name: string; summary: string }[] {
  const sections = state?.sections;
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) return [];
  return Object.entries(sections as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, summary: describeSection(value) }));
}
