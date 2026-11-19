/**
 * 문장 줄 묶기(미르 11/12 두 번째) — 한 줄에 들어가는 문장들은 마침표가 있어도 나란히 두고, 그 줄에 안 들어가는 문장만
 * 새 줄에서 시작한다. 처음(PR #131)엔 문장마다 줄을 바꿨더니 짧은 문장 서넛이 서너 줄로 늘어서 오히려 어색했다.
 * 한 줄보다 긴 문장은 제 줄에서 시작해 흘러 넘치고, 그 뒤 문장도 새 줄에서 시작한다(긴 문장 꼬리에 다음 문장이 붙어 흐르지 않게).
 * 문장 끝 뒤의 띄어쓰기 한 칸을 줄바꿈 한 자로 바꾼다. 글 길이가 그대로라 글자 찍기 자리가 밀리지 않는다.
 * 줄 수가 정한 수를 넘으면 바꾸지 않는다 — 부르는 쪽이 지금처럼 흘려 그린다(대화창 쪽 나누기 · 알림 · 장면 대사).
 * 굵게 표시(**, emphasis.ts)는 문장 끝 판정에서 뺀다 — 폭은 부르는 쪽 measure 가 표시를 빼고 잰다.
 * React · 별칭을 쓰지 않는다(node --test).
 */

import { stripEmphasis } from "./emphasis.ts";

/** 문장 끝 — 마침표 · 물음표 · 느낌표 · 말줄임. 뒤에 닫는 따옴표 · 괄호가 붙어도 문장 끝이다 */
const SENTENCE_END = /[.!?…][」』’”)\]]*$/;

export type Measure = (text: string) => number;

/** 한 문단(줄바꿈 없는 글)에서 문장이 끝나는 자리 — 문장 끝 바로 뒤 띄어쓰기 한 칸의 위치(문자열 자리) */
function sentenceGaps(paragraph: string): number[] {
  const gaps: number[] = [];
  for (const match of paragraph.matchAll(/ (?=\S)/g)) {
    const before = paragraph.slice(0, match.index).split(" ").pop() ?? "";
    if (SENTENCE_END.test(stripEmphasis(before))) gaps.push(match.index);
  }
  return gaps;
}

/**
 * 문단을 줄로 묶을 자리를 고른다 — 문장들을 앞에서부터 한 줄 폭(maxWidth)에 들어가는 만큼 나란히 담고, 다음 문장이 그 줄에
 * 안 들어가면 그 문장 앞에서 줄을 바꾼다. 지금 줄이 이미 넘친 긴 문장이면 다음 문장은 늘 새 줄이다.
 */
function packGaps(paragraph: string, measure: Measure, maxWidth: number): number[] {
  const gaps = sentenceGaps(paragraph);
  if (gaps.length === 0) return [];
  const bounds = [-1, ...gaps, paragraph.length];
  const pieces = bounds.slice(1).map((end, i) => paragraph.slice(bounds[i] + 1, end));
  const space = measure(" ");
  const kept: number[] = [];
  /** 지금 줄의 폭 */
  let width = measure(pieces[0]);
  for (let i = 1; i < pieces.length; i += 1) {
    const next = measure(pieces[i]);
    if (width <= maxWidth && width + space + next <= maxWidth) {
      width += space + next;
      continue;
    }
    kept.push(gaps[i - 1]);
    width = next;
  }
  return kept;
}

/** 띄어쓰기 단위로 흘려 쓸 때 몇 줄이 되나(word-break: keep-all 과 같은 셈 — 낱말 사이에서만 줄이 바뀐다) */
export function wrappedLines(text: string, measure: Measure, maxWidth: number): number {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return 1;
  const space = measure(" ");
  let lines = 1;
  let width = 0;
  for (const word of words) {
    const wordWidth = measure(word);
    if (width === 0) {
      // 한 낱말이 한 줄보다 길면 그 낱말만으로 여러 줄
      lines += Math.max(0, Math.ceil(wordWidth / maxWidth) - 1);
      width = wordWidth > maxWidth ? wordWidth % maxWidth : wordWidth;
    } else if (width + space + wordWidth <= maxWidth) width += space + wordWidth;
    else {
      lines += 1 + Math.max(0, Math.ceil(wordWidth / maxWidth) - 1);
      width = wordWidth > maxWidth ? wordWidth % maxWidth : wordWidth;
    }
  }
  return lines;
}

/** 글을 줄 단위 조각(한 줄에 묶인 문장들 · 긴 문장 하나)으로 나눈다. 원래 줄바꿈도 조각 경계다. 빈 조각은 없다 */
export function sentenceUnits(text: string, measure: Measure, maxWidth: number): string[] {
  const units: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) continue;
    let start = 0;
    for (const gap of packGaps(paragraph, measure, maxWidth)) {
      units.push(paragraph.slice(start, gap));
      start = gap + 1;
    }
    units.push(paragraph.slice(start));
  }
  return units.map((unit) => unit.trim()).filter(Boolean);
}

/**
 * 문장을 줄로 묶은 글 — 줄 수가 maxLines 를 넘으면 null(부르는 쪽이 그대로 흘려 그린다).
 * 바꾸는 것은 문장 끝 뒤 띄어쓰기 한 칸뿐이라 글 길이가 그대로다. 바꿀 자리가 없으면(다 한 줄에 들어가면) 글을 그대로 돌려준다.
 */
export function breakSentences(text: string, measure: Measure, maxWidth: number, maxLines: number): string | null {
  let out = "";
  let lines = 0;
  const paragraphs = text.split("\n");
  for (const [index, paragraph] of paragraphs.entries()) {
    let broken = paragraph;
    let start = 0;
    for (const gap of packGaps(paragraph, measure, maxWidth)) {
      lines += wrappedLines(paragraph.slice(start, gap), measure, maxWidth);
      broken = `${broken.slice(0, gap)}\n${broken.slice(gap + 1)}`;
      start = gap + 1;
    }
    lines += wrappedLines(paragraph.slice(start), measure, maxWidth);
    out += (index ? "\n" : "") + broken;
  }
  return lines <= maxLines ? out : null;
}
