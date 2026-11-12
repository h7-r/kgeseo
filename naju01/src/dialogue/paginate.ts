/**
 * 긴 대사를 대화창 한 쪽에 들어가는 길이로 나눈다. 창은 줄 수가 고정이라 넘치는 글은 다음 쪽으로 간다.
 * 문장 끝 → 쉼표 · 줄표 → 띄어쓰기 순으로 끊을 자리를 찾고, [E] 같은 키 표시는 쪼개지 않는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */
import { stripEmphasis } from "./emphasis.ts";
import { sentenceUnits, wrappedLines } from "./sentences.ts";

/** 한글은 한 칸, 영문 · 숫자 · 기호는 반 칸 남짓으로 센다 — 창 너비를 글자 수로 어림할 때 쓴다. 굵게 표시(**)는 세지 않는다 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of stripEmphasis(text)) width += char.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
  return width;
}

const SENTENCE_END = /[.!?…。」』)]$/;
const SOFT_BREAK = /[,·—:;]$/;

/** 낱말(띄어쓰기 단위)로 쪼갠다. 줄바꿈은 낱말 사이의 강제 끊김으로 남긴다 */
function toWords(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(\n)|[ \t]+/)
    .filter((word): word is string => !!word);
}

/**
 * capacity = 한 쪽에 들어가는 폭(한글 글자 수 기준). 한 낱말이 한 쪽보다 길면 그 낱말만 글자 단위로 자른다.
 * 마지막 쪽에 「…다.」 한 마디만 넘어가면 앞 쪽과 고르게 다시 나눈다(balanceTail).
 */
export function paginate(text: string, capacity: number): string[] {
  const limit = Math.max(8, capacity);
  const words = toWords(text.trim());
  if (words.length === 0) return [];

  const pages: string[] = [];
  let page: string[] = [];
  let width = 0;
  /** 지금 쪽에서 마지막으로 본 끊기 좋은 자리(낱말 수) — 문장 끝이 쉼표보다 먼저다 */
  let sentenceCut = 0;
  let softCut = 0;

  const flush = (count: number) => {
    const head = page.slice(0, count).join(" ").trim();
    if (head) pages.push(head);
    page = page.slice(count);
    width = textWidth(page.join(" "));
    sentenceCut = 0;
    softCut = 0;
  };

  for (const word of words) {
    if (word === "\n") {
      // 줄바꿈은 문단 경계다 — 남은 자리가 넉넉하면 이어 붙이고, 반 넘게 찼으면 쪽을 넘긴다
      if (width > limit * 0.5) flush(page.length);
      else if (page.length) sentenceCut = page.length;
      continue;
    }
    let piece = word;
    // 한 쪽보다 긴 낱말(띄어쓰기 없는 긴 글)은 글자 단위로 자른다
    while (textWidth(piece) > limit) {
      if (page.length) flush(page.length);
      let cut = 0;
      let used = 0;
      for (const char of piece) {
        const next = used + textWidth(char);
        if (next > limit) break;
        used = next;
        cut += char.length;
      }
      pages.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    if (!piece) continue;
    const added = textWidth(piece) + (page.length ? 0.55 : 0);
    if (width + added > limit && page.length) {
      // 문장 끝에서 끊는다. 그러면 쪽이 너무 비게 되면(4할 미만) 쉼표, 그것도 없으면 꽉 채운 자리에서
      const filled = (count: number) => textWidth(page.slice(0, count).join(" ")) >= limit * 0.4;
      if (sentenceCut && filled(sentenceCut)) flush(sentenceCut);
      else if (softCut && filled(softCut)) flush(softCut);
      else flush(page.length);
    }
    page.push(piece);
    width = textWidth(page.join(" "));
    const bare = stripEmphasis(piece);
    if (SENTENCE_END.test(bare)) sentenceCut = page.length;
    else if (SOFT_BREAK.test(bare)) softCut = page.length;
  }
  if (page.length) flush(page.length);
  return balanceTail(pages, limit);
}

/** 마지막 쪽에 한두 마디만 남으면 앞 쪽과 합쳐 가운데쯤의 문장 끝(없으면 쉼표 · 띄어쓰기)에서 다시 나눈다 */
function balanceTail(pages: string[], limit: number): string[] {
  if (pages.length < 2) return pages;
  const last = pages[pages.length - 1];
  if (textWidth(last) >= limit * 0.3) return pages;
  const words = `${pages[pages.length - 2]} ${last}`.split(" ");
  const total = textWidth(words.join(" "));
  let best = -1;
  let bestScore = Infinity;
  for (let count = 1; count < words.length; count++) {
    const head = textWidth(words.slice(0, count).join(" "));
    if (head > limit || total - head > limit) continue;
    const word = stripEmphasis(words[count - 1]);
    // 문장 끝이면 가운데에서 조금 멀어도 그 자리를 고른다
    const penalty = SENTENCE_END.test(word) ? 0 : SOFT_BREAK.test(word) ? limit * 0.15 : limit * 0.3;
    const score = Math.abs(head - total / 2) + penalty;
    if (score < bestScore) {
      bestScore = score;
      best = count;
    }
  }
  if (best < 0) return pages;
  return [...pages.slice(0, -2), words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

/** 한 줄 폭 어림에서 낱말 단위 줄바꿈으로 줄 끝이 비는 몫을 뺀다 */
const WRAP_FILL = 0.95;
/** 문장이 한 쪽보다 길 때 그 문장만 예전처럼 흘려 나누는 몫(DialogueLayer LINE_FILL 과 같은 값) */
const FALLBACK_FILL = 0.85;

/**
 * 문장을 줄로 묶어 쪽을 나눈다(미르 11/12) — 한 쪽은 maxLines 줄까지, 쪽 경계는 늘 문장 끝이다.
 * perLine = 한 줄에 들어가는 폭(한글 글자 수). 한 줄에 들어가는 문장들은 나란히 한 줄에 둔다(sentences.ts).
 * 문장 하나가 한 쪽보다 길면 그 문장만 예전처럼(paginate) 흘려 나눈다. 마지막 쪽이 한 줄뿐이면 앞 쪽과 고르게 나눈다.
 * 쪽 안의 줄 사이는 줄바꿈 한 자다 — 화면은 white-space: pre-line 으로 그린다.
 */
export function paginateLines(text: string, perLine: number, maxLines: number): string[] {
  const maxWidth = Math.max(8, perLine) * WRAP_FILL;
  const units = sentenceUnits(text.trim(), textWidth, maxWidth);
  if (units.length === 0) return [];
  const limit = Math.max(1, maxLines);
  const pages: { units: string[]; lines: number[] }[] = [];
  let page: { units: string[]; lines: number[] } = { units: [], lines: [] };
  const used = () => page.lines.reduce((sum, n) => sum + n, 0);
  const flush = () => {
    if (page.units.length) pages.push(page);
    page = { units: [], lines: [] };
  };
  const out: (string | { units: string[]; lines: number[] })[] = [];
  for (const unit of units) {
    const lines = wrappedLines(unit, textWidth, maxWidth);
    if (lines > limit) {
      flush();
      for (const done of pages.splice(0)) out.push(done);
      out.push(...paginate(unit, Math.max(8, perLine) * limit * FALLBACK_FILL));
      continue;
    }
    if (page.units.length && used() + lines > limit) flush();
    page.units.push(unit);
    page.lines.push(lines);
  }
  flush();
  out.push(...pages);
  // 마지막 쪽이 한 줄짜리면 앞 쪽(문장 쪽)의 끝 문장을 넘겨 고르게 — 넘겨도 두 쪽 다 줄 수 안일 때만
  const last = out.at(-1);
  const prev = out.at(-2);
  if (typeof last === "object" && typeof prev === "object") {
    const sum = (lines: number[]) => lines.reduce((total, n) => total + n, 0);
    while (prev.units.length > 1 && sum(last.lines) < sum(prev.lines) - 1) {
      const moved = prev.lines[prev.lines.length - 1];
      if (sum(last.lines) + moved > limit || sum(last.lines) + moved > sum(prev.lines) - moved) break;
      last.units.unshift(prev.units.pop()!);
      last.lines.unshift(prev.lines.pop()!);
    }
  }
  return out.map((item) => (typeof item === "string" ? item : item.units.join("\n")));
}
