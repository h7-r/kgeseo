/**
 * 긴 대사를 대화창 한 쪽에 들어가는 길이로 나눈다. 창은 줄 수가 고정이라 넘치는 글은 다음 쪽으로 간다.
 * 문장 끝 → 쉼표 · 줄표 → 띄어쓰기 순으로 끊을 자리를 찾고, [E] 같은 키 표시는 쪼개지 않는다.
 * React · 별칭을 쓰지 않는다(node --test).
 */

/** 한글은 한 칸, 영문 · 숫자 · 기호는 반 칸 남짓으로 센다 — 창 너비를 글자 수로 어림할 때 쓴다 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
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
    if (SENTENCE_END.test(piece)) sentenceCut = page.length;
    else if (SOFT_BREAK.test(piece)) softCut = page.length;
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
    const word = words[count - 1];
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
