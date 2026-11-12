/**
 * 문장마다 줄 바꾸기(미르 11/12) — 마침표 찍힌 문장 두세 개가 한 줄에 이어 붙어 흘러 읽기 힘들다는 지적.
 * 문장 끝 뒤의 띄어쓰기 한 칸을 줄바꿈 한 자로 바꾼다. 글 길이가 그대로라 글자 찍기 자리가 밀리지 않는다.
 * 「좋아요.」 「철컥!」처럼 아주 짧은 말은 이웃 문장과 한 줄에 둔다(한 줄에 한 마디만 덩그러니 남지 않게).
 * 줄 수가 정한 수를 넘으면 바꾸지 않는다 — 부르는 쪽이 지금처럼 흘려 그린다(대화창 쪽 나누기 · 알림 · 장면 대사).
 * React · 별칭을 쓰지 않는다(node --test).
 */

/** 문장 끝 — 마침표 · 물음표 · 느낌표 · 말줄임. 뒤에 닫는 따옴표 · 괄호가 붙어도 문장 끝이다 */
const SENTENCE_END = /[.!?…][」』’”)\]]*$/;
/** 이 폭(한글 자) 이하의 문장은 이웃 문장과 한 줄에 둔다 — 「좋아요.」 「네.」 「철컥!」 「그래요?」 정도 */
export const SHORT_SENTENCE = 4;

export type Measure = (text: string) => number;

/** 한 문단(줄바꿈 없는 글)에서 줄을 바꿀 자리 — 문장 끝 바로 뒤 띄어쓰기 한 칸의 위치(문자열 자리) */
function sentenceGaps(paragraph: string): number[] {
  const gaps: number[] = [];
  for (const match of paragraph.matchAll(/ (?=\S)/g)) {
    const before = paragraph.slice(0, match.index).split(" ").pop() ?? "";
    if (SENTENCE_END.test(before)) gaps.push(match.index);
  }
  return gaps;
}

/**
 * 문단을 줄 단위(문장, 짧은 말은 이웃과 묶음)로 자를 자리를 고른다.
 * 짧은 말(shortWidth 이하)은 다음 문장과 한 줄에 두고, 마지막 문장이 짧으면 앞 문장과 둔다.
 * 한 줄에는 짧은 말을 하나만 붙인다 — 「좋아요. 저쪽으로 가요. 어서요.」처럼 세 문장이 다시 한 줄에 몰리지 않게.
 */
function unitGaps(paragraph: string, measure: Measure, shortWidth: number): number[] {
  const gaps = sentenceGaps(paragraph);
  if (gaps.length === 0) return [];
  const bounds = [-1, ...gaps, paragraph.length];
  const pieces = bounds.slice(1).map((end, i) => paragraph.slice(bounds[i] + 1, end));
  const isShort = (i: number) => measure(pieces[i]) <= shortWidth;
  const kept: number[] = [];
  /** 지금 줄의 문장 수 */
  let count = 0;
  for (let i = 0; i < gaps.length; i += 1) {
    count += 1;
    // 이 줄이 짧은 말 하나뿐이면 끊지 않고 다음 문장과 이어 쓴다
    if (count === 1 && isShort(i)) continue;
    kept.push(gaps[i]);
    count = 0;
  }
  // 마지막 문장이 짧고, 앞 줄이 한 문장뿐이면 앞 줄에 붙인다
  const last = pieces.length - 1;
  const prevAlone =
    kept.length > 0 &&
    (kept.length === 1 ? gaps.indexOf(kept[0]) === 0 : gaps.indexOf(kept.at(-1)!) - gaps.indexOf(kept.at(-2)!) === 1);
  if (count === 0 && isShort(last) && prevAlone) kept.pop();
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

/** 글을 줄 단위 조각(문장 · 묶음)으로 나눈다. 원래 줄바꿈도 조각 경계다. 빈 조각은 없다 */
export function sentenceUnits(text: string, measure: Measure, shortWidth = SHORT_SENTENCE): string[] {
  const units: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) continue;
    let start = 0;
    for (const gap of unitGaps(paragraph, measure, shortWidth)) {
      units.push(paragraph.slice(start, gap));
      start = gap + 1;
    }
    units.push(paragraph.slice(start));
  }
  return units.map((unit) => unit.trim()).filter(Boolean);
}

/**
 * 문장마다 줄을 바꾼 글 — 줄 수가 maxLines 를 넘으면 null(부르는 쪽이 그대로 흘려 그린다).
 * 바꾸는 것은 문장 끝 뒤 띄어쓰기 한 칸뿐이라 글 길이가 그대로다. 바꿀 자리가 없으면 글을 그대로 돌려준다.
 * shortWidth 는 measure 와 같은 단위(화면에서 재면 px)로 준다.
 */
export function breakSentences(
  text: string,
  measure: Measure,
  maxWidth: number,
  maxLines: number,
  shortWidth: number,
): string | null {
  let out = "";
  let lines = 0;
  const paragraphs = text.split("\n");
  for (const [index, paragraph] of paragraphs.entries()) {
    const gaps = unitGaps(paragraph, measure, shortWidth);
    let broken = paragraph;
    let start = 0;
    for (const gap of gaps) {
      lines += wrappedLines(paragraph.slice(start, gap), measure, maxWidth);
      broken = `${broken.slice(0, gap)}\n${broken.slice(gap + 1)}`;
      start = gap + 1;
    }
    lines += wrappedLines(paragraph.slice(start), measure, maxWidth);
    out += (index ? "\n" : "") + broken;
  }
  return lines <= maxLines ? out : null;
}
