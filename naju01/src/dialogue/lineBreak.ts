/**
 * 두 줄 넘게 넘어가는 글의 줄 끊을 자리를 고른다 — 문장 끝 → 쉼표 → 띄어쓰기 순으로, 줄 길이는 고르게(미르 11/12).
 * 줄 수는 그냥 흘렸을 때보다 늘리지 않는다(대화창은 줄 수가 고정이다). 한 줄에 들어가면 손대지 않는다.
 * 고른 자리의 띄어쓰기 한 칸을 줄바꿈 한 자로 바꿔 돌려준다 — 글 길이가 그대로라 글자 찍기 자리가 밀리지 않는다.
 * 화면에서는 `white-space: pre-line` 으로 그린다. React · 별칭을 쓰지 않는다(node --test).
 */

const SENTENCE_END = /[.!?…。」』)]$/;
const SOFT_BREAK = /[,·—:;]$/;

/** 끊는 자리의 값 — 낮을수록 좋다. 줄 길이 차이(0 ~ 1)와 더해 견준다 */
const BREAK_COST = { sentence: 0, soft: 0.25, space: 0.6 };
/** 이보다 줄이 많은 글은 흘러가는 대로 둔다(안내판 같은 긴 글) */
const MAX_LINES = 4;

export type MeasureText = (text: string) => number;

/** maxWidth = 한 줄 폭, measure = 글 조각의 폭(같은 단위), lineLimit = 넘기면 안 되는 줄 수 */
export function breakLines(text: string, maxWidth: number, measure: MeasureText, lineLimit = MAX_LINES): string {
  if (!(maxWidth > 0)) return text;
  return text
    .split("\n")
    .map((paragraph) => breakParagraph(paragraph, maxWidth, measure, lineLimit))
    .join("\n");
}

function breakParagraph(text: string, maxWidth: number, measure: MeasureText, lineLimit: number): string {
  const words = [...text.matchAll(/\S+/g)].map((match) => ({ start: match.index, word: match[0] }));
  if (words.length < 2) return text;
  const space = measure(" ");
  const widths = words.map(({ word }) => measure(word));
  // prefix[i] = 낱말 0 ~ i-1 을 한 줄에 이어 쓴 폭(사이 띄어쓰기 포함, 끝 띄어쓰기 없이는 lineWidth 로)
  const prefix = [0];
  for (const width of widths) prefix.push(prefix[prefix.length - 1] + width + space);
  const lineWidth = (from: number, to: number) => prefix[to] - prefix[from] - space;
  if (lineWidth(0, words.length) <= maxWidth) return text;

  // 그냥 흘렸을 때의 줄 수 — 이 수를 넘기지 않는다
  let lineCount = 1;
  let lineStart = 0;
  for (let index = 1; index <= words.length; index += 1) {
    if (lineWidth(lineStart, index) > maxWidth && index - 1 > lineStart) {
      lineCount += 1;
      lineStart = index - 1;
    }
  }
  // lineLimit = 화면에 실제로 놓인 줄 수 — 잰 폭이 어긋나 줄이 더 필요하다고 나오면 손대지 않는다(Codex 리뷰 6)
  if (lineCount > Math.min(MAX_LINES, lineLimit)) return text;

  /** 낱말 index 앞에서 끊을 수 있는가 — 바로 앞이 띄어쓰기 한 칸일 때만(그 한 칸을 줄바꿈으로 바꾼다) */
  const canBreakBefore = (index: number) => text[words[index].start - 1] === " ";
  const breakCost = (index: number) => {
    const before = words[index - 1].word;
    if (SENTENCE_END.test(before)) return BREAK_COST.sentence;
    if (SOFT_BREAK.test(before)) return BREAK_COST.soft;
    return BREAK_COST.space;
  };

  let best: { cost: number; cuts: number[] } | null = null;
  const cuts: number[] = [];
  const search = (from: number, linesLeft: number, cost: number, min: number, max: number) => {
    if (linesLeft === 1) {
      const width = lineWidth(from, words.length);
      if (width > maxWidth) return;
      const longest = Math.max(max, width);
      const total = cost + (longest - Math.min(min, width)) / longest;
      if (!best || total < best.cost) best = { cost: total, cuts: [...cuts] };
      return;
    }
    for (let index = from + 1; index < words.length; index += 1) {
      const width = lineWidth(from, index);
      if (width > maxWidth) break;
      if (!canBreakBefore(index)) continue;
      cuts.push(index);
      search(index, linesLeft - 1, cost + breakCost(index), Math.min(min, width), Math.max(max, width));
      cuts.pop();
    }
  };
  search(0, lineCount, 0, Infinity, 0);
  const chosen = (best as { cost: number; cuts: number[] } | null)?.cuts;
  if (!chosen) return text;

  // matchAll 의 index 는 UTF-16 자리다 — 문자열 자리로 바로 바꾼다
  let out = text;
  for (const index of chosen) {
    const at = words[index].start - 1;
    out = `${out.slice(0, at)}\n${out.slice(at + 1)}`;
  }
  return out;
}
