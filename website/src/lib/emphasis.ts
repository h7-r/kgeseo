/**
 * 글 속 강조 표기. 데이터에 짧게 적고 화면에서만 색을 입힌다.
 *   **…** 짚어 둘 것 — 정의·권리·기간·숫자·이용자가 할 일
 *   !!…!! 경고 — 금지·책임 제한·불이익·되돌릴 수 없는 일
 */
export type EmphasisTone = "key" | "warn";

export interface TextRun {
  text: string;
  tone?: EmphasisTone;
}

const MARK = /\*\*(.+?)\*\*|!!(.+?)!!/g;

/** 표기를 걷어 내고 글 조각으로 나눈다. 표기 없는 글은 한 조각이다. */
export function parseEmphasis(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARK)) {
    if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index) });
    runs.push(match[1] ? { text: match[1], tone: "key" } : { text: match[2], tone: "warn" });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs;
}

/** 검색처럼 글자만 필요한 곳에 쓴다. */
export const stripEmphasis = (text: string): string => text.replace(MARK, "$1$2");
