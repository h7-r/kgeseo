/**
 * 한글을 자모 단위로 다루는 도구. 금칙어 판정이 「소리가 같은 다른 글자」를 한 모양으로 보려고 쓴다.
 * 초성·중성·종성 번호는 유니코드 한글 음절 배열 순서(초성 19 · 중성 21 · 종성 28) 그대로다.
 */

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const JUNG_COUNT = 21;
const JONG_COUNT = 28;

export const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
export const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
// 0번은 받침 없음
export const JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";

/**
 * NFKC 는 호환 자모(ㅅ U+3145)를 첫가끝 자모(ᄉ U+1109)로 바꾼다. 비교는 호환 자모로 하므로 되돌린다.
 * 첫가끝 받침은 초성과 다른 글자라 받침 자리로 돌려보낸다.
 */
export function toCompatJamo(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0x1100 && code < 0x1100 + CHO.length) return CHO[code - 0x1100];
  if (code >= 0x1161 && code < 0x1161 + JUNG.length) return JUNG[code - 0x1161];
  if (code >= 0x11a8 && code < 0x11a7 + JONG.length) return JONG[code - 0x11a7];
  return char;
}

export interface Syllable {
  cho: number;
  jung: number;
  jong: number;
}

export function isHangulSyllable(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST;
}

export function decompose(char: string): Syllable | null {
  if (!isHangulSyllable(char)) return null;
  const offset = char.charCodeAt(0) - SYLLABLE_FIRST;
  return {
    cho: Math.floor(offset / (JUNG_COUNT * JONG_COUNT)),
    jung: Math.floor(offset / JONG_COUNT) % JUNG_COUNT,
    jong: offset % JONG_COUNT,
  };
}

export function compose({ cho, jung, jong }: Syllable): string {
  return String.fromCharCode(SYLLABLE_FIRST + (cho * JUNG_COUNT + jung) * JONG_COUNT + jong);
}

// 겹받침은 두 자음으로 나눠 둔다. 소리 이어 읽기(연음)에서 뒤 자음만 다음 음절로 넘어간다.
const JONG_SPLIT: Readonly<Record<string, readonly [string, string]>> = {
  ㄳ: ["ㄱ", "ㅅ"],
  ㄵ: ["ㄴ", "ㅈ"],
  ㄶ: ["ㄴ", "ㅎ"],
  ㄺ: ["ㄹ", "ㄱ"],
  ㄻ: ["ㄹ", "ㅁ"],
  ㄼ: ["ㄹ", "ㅂ"],
  ㄽ: ["ㄹ", "ㅅ"],
  ㄾ: ["ㄹ", "ㅌ"],
  ㄿ: ["ㄹ", "ㅍ"],
  ㅀ: ["ㄹ", "ㅎ"],
  ㅄ: ["ㅂ", "ㅅ"],
};
const JONG_JOIN = new Map(Object.entries(JONG_SPLIT).map(([joined, [a, b]]) => [a + b, joined]));

const VOWEL_JOIN = new Map([
  ["ㅗㅏ", "ㅘ"],
  ["ㅗㅐ", "ㅙ"],
  ["ㅗㅣ", "ㅚ"],
  ["ㅜㅓ", "ㅝ"],
  ["ㅜㅔ", "ㅞ"],
  ["ㅜㅣ", "ㅟ"],
  ["ㅡㅣ", "ㅢ"],
]);

// 받침 ㄱ·ㄷ·ㅂ·ㅈ 뒤에 ㅎ이 오면 거센소리가 된다(색히 → 새키).
const ASPIRATED: Readonly<Record<string, string>> = { ㄱ: "ㅋ", ㄷ: "ㅌ", ㅂ: "ㅍ", ㅈ: "ㅊ" };

/**
 * 소리 나는 대로 음절을 다시 나눈다. 「십알」「봊이」처럼 받침을 뒤로 넘겨 쓴 우회를 「시발」「보지」로 되돌린다.
 * - 받침 + ㅇ초성 → 받침(겹받침이면 뒤 자음)이 다음 초성으로 간다. ㅎ 받침은 소리가 없어 지운다.
 * - 받침 + ㅎ초성 → 거센소리 초성 하나로.
 * - 받침이 다음 초성과 같은 소리면(sameSound) 받침을 지운다(색끼 → 새끼). ㅅ·ㅆ 받침은 사이시옷처럼 늘 지운다.
 * sameSound 를 주지 않으면 첫 규칙(연음)만 쓴다. 받침을 지우면 정보가 줄어 금칙어 쪽에는 연음만 건다(빡큐 → 빠큐 → 바꾸).
 * null 은 한글이 아닌 자리 — 그 앞뒤는 잇지 않는다.
 */
export function resyllabify(
  syllables: readonly (Syllable | null)[],
  sameSound?: (jong: string, cho: string) => boolean,
): (Syllable | null)[] {
  const out = syllables.map((syllable) => syllable && { ...syllable });
  for (let i = 0; i < out.length - 1; i++) {
    const current = out[i];
    const next = out[i + 1];
    // ㅇ 받침은 소리가 남아 넘기지 않는다(강아지 ≠ 가아지).
    if (!current?.jong || !next || JONG[current.jong] === "ㅇ") continue;
    const jong = JONG[current.jong];
    const [keep, move] = JONG_SPLIT[jong] ?? ["", jong];
    const nextCho = CHO[next.cho];
    if (nextCho === "ㅇ") {
      current.jong = JONG.indexOf(keep || " ");
      if (move !== "ㅎ") next.cho = CHO.indexOf(move);
    } else if (!sameSound) {
      continue;
    } else if (nextCho === "ㅎ" && ASPIRATED[move]) {
      current.jong = JONG.indexOf(keep || " ");
      next.cho = CHO.indexOf(ASPIRATED[move]);
    } else if (!keep && (jong === "ㅅ" || jong === "ㅆ" || sameSound(jong, nextCho))) {
      current.jong = 0;
    }
  }
  return out;
}

// 두벌식 자판. 대문자는 Shift 자리(된소리·ㅒ·ㅖ)만 따로 있다.
const DUBEOLSIK: Readonly<Record<string, string>> = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ", y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
  Q: "ㅃ", W: "ㅉ", E: "ㄸ", R: "ㄲ", T: "ㅆ", O: "ㅒ", P: "ㅖ",
}; // prettier-ignore

const isVowel = (jamo: string) => jamo !== "" && JUNG.includes(jamo);
const isConsonant = (jamo: string) => jamo !== "" && CHO.includes(jamo);
// ㄸ·ㅃ·ㅉ 는 받침이 될 수 없다.
const isJong = (jamo: string) => jamo !== "" && jamo !== " " && JONG.includes(jamo);

/** 글자와 그 글자가 온 원래 위치. 바꾼 글에서 찾은 낱말을 원래 글 위치로 되돌릴 때 쓴다. */
export interface Traced {
  char: string;
  at: number;
}

/**
 * 한글 자판 상태로 친 영문을 한글로 조합한다(tlqkf → 시발, qudtls → 병신).
 * 영문 낱말마다 따로 조합하고, 낱자모가 하나라도 남으면 그 낱말은 영문 그대로 둔다 —
 * 진짜 영단어(where, backdrop)를 조합하면 대개 낱자모가 남는다.
 */
export function typeOnDubeolsik(text: readonly Traced[]): Traced[] {
  const out: Traced[] = [];
  let run: Traced[] = [];
  const flush = () => {
    const typed = composeJamo(
      run.map(({ char, at }) => ({ char: DUBEOLSIK[char] ?? DUBEOLSIK[char.toLowerCase()], at })),
    );
    out.push(...(typed.every(({ char }) => isHangulSyllable(char)) ? typed : run));
    run = [];
  };
  for (const traced of text) {
    if (/[a-z]/i.test(traced.char)) run.push(traced);
    else {
      flush();
      out.push(traced);
    }
  }
  flush();
  return out;
}

/** 낱자모 줄을 음절로 조합한다(ㅅㅣㅂㅏㄹ → 시발). 자모가 아닌 글자와 조합되지 않는 자모는 그대로 둔다. */
export function composeJamo(keys: readonly Traced[]): Traced[] {
  const jamo = (index: number) => keys[index]?.char ?? "";
  const out: Traced[] = [];
  let i = 0;
  while (i < keys.length) {
    const { char: cho, at } = keys[i];
    if (!isConsonant(cho) || !isVowel(jamo(i + 1))) {
      out.push(keys[i]);
      i += 1;
      continue;
    }
    let jung = jamo(i + 1);
    i += 2;
    const joinedVowel = VOWEL_JOIN.get(jung + jamo(i));
    if (joinedVowel) {
      jung = joinedVowel;
      i += 1;
    }
    // 받침: 뒤에 모음이 오면 그 자음은 다음 음절 초성이다.
    let jong = "";
    if (isJong(jamo(i)) && !isVowel(jamo(i + 1))) {
      jong = jamo(i);
      i += 1;
      const joinedJong = JONG_JOIN.get(jong + jamo(i));
      if (joinedJong && !isVowel(jamo(i + 1))) {
        jong = joinedJong;
        i += 1;
      }
    }
    out.push({
      char: compose({ cho: CHO.indexOf(cho), jung: JUNG.indexOf(jung), jong: JONG.indexOf(jong || " ") }),
      at,
    });
  }
  return out;
}
