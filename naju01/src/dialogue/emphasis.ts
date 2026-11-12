/**
 * 굵게 표시(미르 11/12) — 원고에서 강조할 곳을 **두 별표**로 감싼다. 화면은 <strong> 으로 그리고(RichText), 폭 · 글자 수 ·
 * 글자 찍기 자리 · 읽는 시간은 표시를 뺀 글로 센다. 짝이 안 맞는 별표는 굵게 하지 않고 지운다(글자 그대로 드러나지 않게).
 * React · 별칭을 쓰지 않는다(node --test).
 */

const MARK = "**";

export interface TextRun {
  text: string;
  strong: boolean;
}

/** 표시를 뺀 글 — 폭 재기 · 글자 수 · 기록용 */
export const stripEmphasis = (text: string) => text.split(MARK).join("");

/** 글을 보통 · 굵은 조각으로 나눈다. 짝 없는 마지막 표시는 보통 글로 둔다. 빈 조각은 없다 */
export function emphasisRuns(text: string): TextRun[] {
  const parts = text.split(MARK);
  // 표시가 홀수 개면 마지막 것은 짝이 없다 — 그 뒤 글은 앞 보통 글에 잇는다
  if (parts.length % 2 === 0) {
    const tail = parts.pop() ?? "";
    parts[parts.length - 1] += tail;
  }
  const runs: TextRun[] = [];
  parts.forEach((part, index) => {
    if (!part) return;
    const strong = index % 2 === 1;
    const last = runs.at(-1);
    if (last && last.strong === strong) last.text += part;
    else runs.push({ text: part, strong });
  });
  return runs;
}

/** 보이는 글자 start ~ end(표시를 뺀 자리) 만 남긴 조각 — 글자 찍기가 별표를 한 자씩 드러내지 않게 */
export function sliceRuns(runs: readonly TextRun[], start: number, end = Infinity): TextRun[] {
  const out: TextRun[] = [];
  let at = 0;
  for (const run of runs) {
    const from = Math.max(start, at);
    const to = Math.min(end, at + run.text.length);
    if (to > from) out.push({ text: run.text.slice(from - at, to - at), strong: run.strong });
    at += run.text.length;
  }
  return out;
}

/**
 * 쪽마다 표시 짝을 맞춘다 — 쪽 경계가 굵은 글 가운데에 떨어지면 앞 쪽 끝에서 닫고 다음 쪽 앞에서 다시 연다.
 * 쪽 나누기(paginate)는 낱말 사이에서 자르므로 「**빛 물고기**」가 두 쪽에 걸칠 수 있다.
 */
export function balanceEmphasis(pages: readonly string[]): string[] {
  let isOpen = false;
  return pages.map((page) => {
    const opened = isOpen;
    const marks = page.split(MARK).length - 1;
    isOpen = marks % 2 === 1 ? !isOpen : isOpen;
    return `${opened ? MARK : ""}${page}${isOpen ? MARK : ""}`;
  });
}
