import POLICY from "../../../shared/nickname-policy.json";
import {
  CHO,
  JONG,
  JUNG,
  compose,
  composeJamo,
  decompose,
  resyllabify,
  toCompatJamo,
  typeOnDubeolsik,
  type Syllable,
  type Traced,
} from "./koreanText";

/**
 * 닉네임 판정과 금칙어 찾기. 목록은 저장소 공용 shared/nickname-policy.json 하나를 백엔드와 같이 읽는다.
 * 프론트가 먼저 막아 바로 안내하고, 서버가 같은 목록으로 한 번 더 막는다.
 *
 * 한국어 욕은 한 끗 차이라 글자 그대로 비교하면 씨빨·쒸발·tlqkf 가 다 빠져나가고, 반대로 넓게 잡으면
 * 시바견·포지션·십 년이 걸린다. 그래서 글을 여러 모양으로 바꿔 보되, 받침 유무처럼 뜻을 가르는 차이는 남겨 둔다.
 */

export const NICKNAME_MIN_LENGTH = POLICY.minLength;
export const NICKNAME_MAX_LENGTH = POLICY.maxLength;

type Category = keyof typeof POLICY.forbidden.categories;
export type ProfanityCategory = Category | "reserved";

export interface ProfanityMatch {
  category: ProfanityCategory;
  /** 목록에 적힌 낱말. 화면에 보여 주지 않는다 — 어느 말이 걸렸는지 알려 주면 우회 연습에 쓰인다. */
  word: string;
  /** NFKC 로 다듬은 글에서 걸린 자리 [start, end). 자판 영문(tlqkf)은 조합된 음절의 첫 자 기준이라 끝이 조금 짧다. */
  start: number;
  end: number;
}

// ── 글자를 비교용 부호로 ─────────────────────────────────────
// 한글 음절은 초·중·종성 세 부호로 편다. 자리마다 다른 사용자 영역 글자를 써서 초성은 초성끼리만 맞는다.
const CHO_BASE = 0xe000;
const JUNG_BASE = 0xe020;
const JONG_BASE = 0xe040;
// 낱자모(ㅅㅂ)는 음절 초성과 다른 부호로 둔다. 같게 두면 '시ㅂ'이 시바견의 '시바'에 맞는다.
const LONE_BASE = 0xe060;
const COMPAT_FIRST = 0x3131;
// 자유 글의 띄어쓰기·문장부호 자리. 부호로는 건너뛰어(시 발 → 시발) 붙여 비교하되, 연음은 넘지 않는다(건 맞 ≠ 건마).
const BREAK = "\u0000";

function groupTable(alphabet: string, groups: readonly string[]): number[] {
  return [...alphabet].map((jamo, index) => {
    const group = groups.find((members) => members.includes(jamo));
    return group ? alphabet.indexOf(group[0]) : index;
  });
}
const CHO_GROUP = groupTable(CHO, POLICY.matching.consonantGroups);
const JUNG_GROUP = groupTable(JUNG, POLICY.matching.vowelGroups);
// 받침도 초성과 같은 묶음을 쓴다. 묶음 대표(ㄱㄷㅂㅅㅈ)는 모두 받침이 될 수 있다.
const JONG_GROUP = groupTable(JONG, POLICY.matching.consonantGroups);

const sameSoundGroups = POLICY.matching.consonantGroups;
// 받침 지우기(색끼 → 새끼)는 막히는 소리 묶음끼리만. ㄴ·ㄹ·ㅁ까지 지우면 존나 → 조나(조나단)처럼 멀쩡한 말이 생긴다.
const sameSound = (jong: string, cho: string) =>
  sameSoundGroups.some((group) => group.includes(jong) && group.includes(cho));

function groupedJamo(jamo: string): string {
  if (CHO.includes(jamo)) return CHO[CHO_GROUP[CHO.indexOf(jamo)]];
  if (JUNG.includes(jamo)) return JUNG[JUNG_GROUP[JUNG.indexOf(jamo)]];
  return jamo;
}

type Script = "hangul" | "latin" | "digit" | "other";

interface Unit {
  code: string;
  at: number;
  script: Script;
}

interface Piece {
  syllable: Syllable | null;
  char: string;
  at: number;
}

/** keepBreaks 면 BREAK 를 경계 부호로 남긴다 — 소리 나는 대로 바꾼 모양은 낱말을 넘어 붙이지 않는다. */
function encode(pieces: readonly Piece[], grouped: boolean, keepBreaks = false): Unit[] {
  const units: Unit[] = [];
  const push = (code: number, at: number) => units.push({ code: String.fromCharCode(code), at, script: "hangul" });
  for (const { syllable, char, at } of pieces) {
    if (char === BREAK) {
      if (keepBreaks) units.push({ code: " ", at, script: "other" });
      continue;
    }
    if (syllable) {
      push(CHO_BASE + (grouped ? CHO_GROUP[syllable.cho] : syllable.cho), at);
      push(JUNG_BASE + (grouped ? JUNG_GROUP[syllable.jung] : syllable.jung), at);
      push(JONG_BASE + (grouped ? JONG_GROUP[syllable.jong] : syllable.jong), at);
    } else if (char >= "ㄱ" && char <= "ㅣ") {
      // 낱자모는 자유 글에서만 나온다(닉네임은 형식 단계에서 막힌다).
      push(LONE_BASE + (grouped ? groupedJamo(char) : char).charCodeAt(0) - COMPAT_FIRST, at);
    } else {
      const script = /[a-z]/.test(char) ? "latin" : /[0-9]/.test(char) ? "digit" : "other";
      // 글자가 아닌 것(띄어쓰기·기호)만 한 부호로 모은다. 옛한글 자모 같은 글자는 제 모양 그대로.
      units.push({ code: script === "other" && !/\p{L}/u.test(char) ? " " : char, at, script });
    }
  }
  return units;
}

const toPieces = (text: readonly Traced[]): Piece[] =>
  text.map(({ char, at }) => ({ syllable: decompose(char), char: toCompatJamo(char), at }));

const SILENT_CHO = CHO.indexOf("ㅇ");

/** 소리 나는 대로 다시 나눈 모양. linkOnly 면 연음만 — 금칙어 쪽은 받침을 지우지 않는다. */
function soundedOut(pieces: readonly Piece[], linkOnly = false): Piece[] {
  const syllables = resyllabify(
    pieces.map((piece) => piece.syllable),
    linkOnly ? undefined : sameSound,
  );
  return pieces.map((piece, index) => ({ ...piece, syllable: syllables[index] }));
}

/**
 * 늘여 쓴 욕을 줄인다(시이이잉발 → 시발, 시바아아알 → 시발, 병시이인 → 병신, 시ㅡ발 → 시발).
 * 건너뛰는 군소리: 숫자·기호·띄어쓰기, 조합되지 않는 낱자모, 바로 앞과 같은 음절,
 * 앞 음절과 같은 모음 묶음의 ㅇ 음절(받침 없거나 ㅇ). ㅇ 음절에 다른 받침이 있으면 앞 음절 받침으로 옮긴다(바알 → 발).
 * 모음 규칙은 띄어쓰기를 넘지 않는다 — '다시 이발'이 '다시발'이 되지 않게.
 */
function unstretch(text: readonly Traced[], source: string, keep: 1 | 2): Traced[] {
  const out: Traced[] = [];
  const pieces = composeJamo(text.map(({ char, at }) => ({ char: toCompatJamo(char), at })));
  let spaced = false;
  pieces.forEach((piece, index) => {
    const { char } = piece;
    if (char === BREAK || !/\p{L}/u.test(char) || (char >= "ㄱ" && char <= "ㅣ")) {
      // 띄어쓰기는 경계로 남긴다 — 줄인 뒤 소리 나는 대로 바꿀 때 낱말을 넘어 잇지 않게.
      if (/\s/.test(source[piece.at]) && !spaced) {
        spaced = true;
        out.push({ char: BREAK, at: piece.at });
      }
      return;
    }
    const syllable = decompose(char);
    const last = out.findLast((kept) => kept.char !== BREAK);
    const before = last && decompose(last.char);
    if (syllable && last && before) {
      // 같은 음절 반복은 keep 개까지만(띄어쓰기는 넘지 않는다). 2로도 줄여 봐야 퐁퐁남·딸딸이처럼 원래 겹친 말이 남는다.
      const kept = out.filter((k) => k.char !== BREAK);
      if (!spaced && last.char === char && (keep === 1 || kept.at(-2)?.char === char)) return;
      if (!spaced && isDrawl(before, syllable)) {
        if (!syllable.jong || JONG[syllable.jong] === "ㅇ") return;
        // 받침 미루기(바알 → 발)는 낱말 끝에서만. '씨입니다'가 '씹'이 되지 않게.
        // 다음 글자는 군소리(기호·낱자모)를 건너뛰고 본다. 띄어쓰기는 낱말 끝이다.
        const next = pieces
          .slice(index + 1)
          .find(({ char: c, at }) => decompose(c) || /[a-z]/.test(c) || /\s/.test(source[at]));
        if (!before.jong && (!next || !decompose(next.char))) {
          out[out.lastIndexOf(last)] = { char: compose({ ...before, jong: syllable.jong }), at: last.at };
          return;
        }
      }
    }
    out.push(piece);
    spaced = false;
  });
  return out;
}

// 늘이기 모음은 홑모음만(아·애·어·에·오·우·으·이) — 야·여는 다른 소리라 '자야지'가 '자지'가 되지 않게.
const DRAWL_VOWELS = "ㅏㅐㅓㅔㅗㅜㅡㅣ";
const isDrawl = (before: Syllable, syllable: Syllable) =>
  syllable.cho === SILENT_CHO &&
  DRAWL_VOWELS.includes(JUNG[syllable.jung]) &&
  JUNG_GROUP[syllable.jung] === JUNG_GROUP[before.jung];

/** 늘임을 줄인 모양: 한글은 unstretch, 영문은 겹친 글자를 한 자로(fuuuck → fuck). */
function collapse(text: readonly Traced[], source: string, keep: 1 | 2): Traced[] {
  const unstretched = unstretch(text, source, keep);
  return unstretched.filter(({ char }, index) => !/[a-z]/.test(char) || char !== unstretched[index - 1]?.char);
}

// ── 목록을 한 번만 부호로 바꿔 둔다 ─────────────────────────────
type Kind = "contains" | "strict" | "word";

interface Pattern {
  code: string;
  word: string;
  category: ProfanityCategory;
  kind: Kind;
  /**
   * 늘임을 줄여 모양이 바뀐 낱말 — 원래 글을 다시 본다. runs: 영문 겹친 글자 수(niger ≠ nigger),
   * raw·grouped: 낱말 음절이 차례대로 다 있나(냄새 ≠ 네앰).
   */
  recount?: "runs" | "raw" | "grouped";
}

/** 첫 부호로 나눠 둔 목록. 글의 자리마다 그 부호로 시작하는 낱말만 맞춰 본다. */
type PatternIndex = Map<string, Pattern[]>;

const codeOf = (pieces: readonly Piece[], grouped: boolean) =>
  encode(pieces, grouped)
    .map((unit) => unit.code)
    .join("");

interface Index {
  /** 적힌 그대로 비교 — strict·word, 그리고 사칭어 */
  raw: PatternIndex;
  /** 뼈대 비교 — contains */
  grouped: PatternIndex;
  /** 소리 나는 대로 다시 나눈 뼈대 — 글도 같은 모양으로 바꿔 비교한다(봇을아치 → 보스라치 ← 보슬아치) */
  sounded: PatternIndex;
  /** 늘임을 줄인 모양 — 낱말도 같이 줄여야 '엿먹ㅇ어 → 엿먹'이 '엿먹어 → 엿먹'에 맞는다. word 는 넣지 않는다. */
  collapsedRaw: PatternIndex;
  collapsedGrouped: PatternIndex;
}

function addPattern(index: PatternIndex, pattern: Pattern) {
  const bucket = index.get(pattern.code[0]) ?? [];
  bucket.push(pattern);
  index.set(pattern.code[0], bucket);
}

/** fuzzy 를 켜면 contains 낱말만 뼈대로 비교한다. strict·word 는 늘 적힌 그대로(씹 ≠ 십, 애자 ≠ 에자). */
function buildIndex(
  lists: readonly { category: ProfanityCategory; kind: Kind; words: readonly string[] }[],
  fuzzy: boolean,
): Index {
  const index: Index = {
    raw: new Map(),
    grouped: new Map(),
    sounded: new Map(),
    collapsedRaw: new Map(),
    collapsedGrouped: new Map(),
  };
  for (const { category, kind, words } of lists) {
    for (const word of words) {
      const normalized = word.normalize("NFKC").toLowerCase();
      const traced = [...normalized].map((char, at) => ({ char, at }));
      const pieces = toPieces(traced);
      const isGrouped = fuzzy && kind === "contains";
      // 늘임을 줄인 모양(같은 음절 둘까지·하나까지)도 넣는다. 줄여서 모양이 바뀐 낱말(엿먹어 → 엿먹, nigger → niger)은
      // 걸린 뒤 원래 글에 낱말의 글자가 차례대로 다 있는지 다시 본다(recount) — 냄새가 네앰(→ 냄)에, niger 가 nigger 에 걸리지 않게.
      const hasJamo = pieces.some(({ syllable, char }) => !syllable && char >= "ㄱ" && char <= "ㅣ");
      // word 는 영문만 넣는다. 한글 word 는 조사까지 줄어 경계가 흐려진다(시스템에 → 시스템).
      const wordOk = kind !== "word" || /^[a-z]+$/.test(normalized);
      const shapes = new Set(
        [2, 1].map((keep) => codeOf(toPieces(collapse(traced, normalized, keep as 1 | 2)), false)),
      );
      for (const keep of [2, 1] as const) {
        const collapsed = toPieces(collapse(traced, normalized, keep));
        const rawCode = codeOf(collapsed, false);
        if (hasJamo || !wordOk || (keep === 1 && shapes.size === 1)) continue;
        const changed = rawCode !== codeOf(pieces, false);
        addPattern(isGrouped ? index.collapsedGrouped : index.collapsedRaw, {
          code: codeOf(collapsed, isGrouped),
          word,
          category,
          kind,
          recount: changed ? (/[a-z]/.test(normalized) ? "runs" : isGrouped ? "grouped" : "raw") : undefined,
        });
      }
      if (!isGrouped) {
        addPattern(index.raw, { code: codeOf(pieces, false), word, category, kind });
        continue;
      }
      addPattern(index.grouped, { code: codeOf(pieces, true), word, category, kind });
      addPattern(index.sounded, { code: codeOf(soundedOut(pieces, true), true), word, category, kind });
    }
  }
  return index;
}

const KINDS: readonly Kind[] = ["contains", "strict", "word"];

// 사칭어는 뼈대로 묶지 않는다. 묶으면 윤영자(이름)가 운영자로 읽힌다.
const RESERVED_INDEX = buildIndex(
  [
    { category: "reserved", kind: "word", words: POLICY.reserved.word },
    { category: "reserved", kind: "contains", words: POLICY.reserved.contains },
  ],
  false,
);

/**
 * 조합 규칙을 펼친다: 앞말 × 바탕, 각 조각은 alternates 의 틀린 표기까지(걸레 → 걸래).
 * 앞말(개·씨)이나 바탕(같은·돼지) 하나만으로는 멀쩡한 말이라 조합된 것만 막는다.
 */
function expandCompose(): { category: Category; kind: Kind; words: string[] }[] {
  const alternates: Readonly<Record<string, readonly string[]>> = POLICY.compose.alternates;
  const spellings = (part: string) => [part, ...(alternates[part] ?? [])];
  return POLICY.compose.rules.map(({ category, kind, prefixes, stems }) => ({
    category: category as Category,
    kind: kind as Kind,
    words: prefixes.flatMap(spellings).flatMap((prefix) => stems.flatMap(spellings).map((stem) => prefix + stem)),
  }));
}

const FORBIDDEN_INDEX = buildIndex(
  [
    ...Object.entries(POLICY.forbidden.categories).flatMap(([category, lists]) =>
      KINDS.map((kind) => ({ category: category as Category, kind, words: lists[kind] })),
    ),
    ...expandCompose(),
  ],
  true,
);

// 정상 낱말. '?' 는 한글 한 음절 자리 — 황보지? 는 황보지은·황보지우(성 황보 + 이름)만 살리고 황보지 단독은 막는다.
// '?' 자리는 정상 낱말 자리에 넣지 않는다 — 황보지랄의 '지랄'이 예외로 덮이지 않게.
interface Allow {
  index: PatternIndex;
  shapes: { pattern: RegExp; literal: number }[];
}
function allowList(words: readonly string[]): Allow {
  const plain = words.filter((word) => !word.includes("?"));
  const shapes = words
    .filter((word) => word.includes("?"))
    .map((word) => ({
      pattern: new RegExp(word.replace(/[.*+^${}()|[\]\\]/g, "\\$&").replaceAll("?", "[가-힣]"), "g"),
      literal: word.indexOf("?"),
    }));
  return { index: buildIndex([{ category: "reserved", kind: "contains", words: plain }], false).raw, shapes };
}
const ALLOW = allowList(POLICY.forbidden.allow);
const TEXT_ALLOW = allowList([...POLICY.forbidden.allow, ...POLICY.forbidden.allowInText]);

const CATEGORY_MESSAGE = Object.fromEntries(
  Object.entries(POLICY.forbidden.categories).map(([category, { message }]) => [category, message]),
) as Record<Category, string>;

// ── 글을 여러 모양으로 ─────────────────────────────────────
interface Form {
  /**
   * plain: 적힌 그대로 / sounded: 소리 나는 대로 다시 나눔 — strict·word 는 여기서 찾지 않는다(님이 → 니미) /
   * collapsed: 늘임을 줄임 — 줄인 낱말 목록과 비교한다.
   */
  shape: "plain" | "sounded" | "collapsed";
  raw: Unit[];
  grouped: Unit[];
  /** 숫자를 한글로 읽은 모양 — 숫자만으로 된 자리는 금칙어로 치지 않는다(18 단독은 나이일 수 있다). */
  needsLetter: boolean;
}

interface Prepared {
  source: string;
  forms: Form[];
  /** 정상 낱말이 차지한 자리 [start, end) */
  allowed: [number, number][];
  /** 원래 글에서 숫자였던 자리 */
  digitAt: Set<number>;
}

const LEET: Readonly<Record<string, string>> = POLICY.matching.leet;
const LEET_ALT: Readonly<Record<string, string>> = { ...LEET, ...POLICY.matching.leetAlternatives };
const DIGIT_READINGS: Readonly<Record<string, string>> = POLICY.matching.digitReadings;

/** 18 → 십팔, 10 → 십, 그 밖에는 한 자씩(2002 → 이공공이). 욕에 쓰이는 숫자는 거의 두 자리라 이 정도면 된다. */
function readDigits(text: readonly Traced[]): Traced[] {
  const out: Traced[] = [];
  for (let i = 0; i < text.length; i++) {
    const { char, at } = text[i];
    const next = text[i + 1]?.char ?? "";
    const isPair = char === "1" && /[0-9]/.test(next) && !/[0-9]/.test(text[i - 1]?.char ?? "");
    if (isPair && !/[0-9]/.test(text[i + 2]?.char ?? "")) {
      const reading = DIGIT_READINGS["10"] + (next === "0" ? "" : DIGIT_READINGS[next]);
      for (const syllable of reading) out.push({ char: syllable, at });
      i += 1;
    } else {
      for (const syllable of DIGIT_READINGS[char] ?? char) out.push({ char: syllable, at });
    }
  }
  return out;
}

const mapChars = (text: readonly Traced[], table: Readonly<Record<string, string>>): Traced[] =>
  text.map(({ char, at }) => ({ char: table[char] ?? char, at }));

function toForms(text: readonly Traced[], needsLetter = false): Form[] {
  const plain = toPieces(text);
  return [plain, soundedOut(plain)].map((pieces, index) => ({
    shape: index === 1 ? "sounded" : "plain",
    raw: encode(pieces, false, index === 1),
    grouped: encode(pieces, true, index === 1),
    needsLetter,
  }));
}

/**
 * 비교할 모양들을 만든다.
 * 닉네임은 밑줄만 건너뛰고, 자유 글은 띄어쓰기·문장부호도 건너뛴다(시 발, 시.발). leet 기호(@ $ !)는 남겨 둔다.
 */
function prepare(source: string, freeText: boolean): Prepared {
  const separator = freeText ? /[\s\p{P}\p{S}]/u : /_/;
  const original: Traced[] = [];
  let at = 0;
  for (const char of source) {
    if (!separator.test(char) || char in LEET) original.push({ char, at });
    else if (freeText) original.push({ char: BREAK, at });
    at += char.length;
  }
  const lower = original.map(({ char, at }) => ({ char: char.toLowerCase(), at }));
  // 글자만 — 사이에 끼운 숫자·기호를 몇 개든 뺀다(시1@3발, f.u.c.k). 띄어쓰기 자리(BREAK)는 연음을 끊으려 남긴다.
  const letters = lower.filter(({ char }) => char === BREAK || /\p{L}/u.test(char));
  // 같은 영문을 셋 이상 겹친 것은 둘로도 줄여 본다(asssshole → asshole, coooons → coons).
  const squeezed = letters.filter(
    ({ char }, index) => !/[a-z]/.test(char) || char !== letters[index - 1]?.char || char !== letters[index - 2]?.char,
  );
  // 글자·숫자만 — 숫자가 낱말의 일부인 말(518탱크)은 기호만 빼고 숫자는 남겨야 맞는다.
  const alphanumerics = lower.filter(({ char }) => char === BREAK || /[\p{L}0-9]/u.test(char));
  const texts: Traced[][] = [lower, letters, alphanumerics, squeezed, mapChars(lower, LEET), mapChars(lower, LEET_ALT)];
  // 한글 자판으로 친 영문은 대소문자가 뜻을 가른다(T → ㅆ). Caps Lock 으로 친 것도 잡게 소문자로 한 번 더 조합한다.
  if (original.some(({ char }) => /[a-z]/i.test(char))) {
    texts.push(typeOnDubeolsik(original), typeOnDubeolsik(lower), typeOnDubeolsik(letters));
  }
  const forms = texts.flatMap((text) => toForms(text));
  for (const keep of [1, 2] as const) {
    const collapsed = toPieces(collapse(lower, source, keep));
    forms.push({
      shape: "collapsed",
      raw: encode(collapsed, false),
      grouped: encode(collapsed, true),
      needsLetter: false,
    });
  }
  if (freeText) {
    // 띄어쓰기를 경계로 남긴 모양 — word 낱말(ass, 애자)은 이 모양에서만 앞뒤가 보인다.
    forms.push(
      ...toForms(lower.map(({ char, at }) => ({ char: char === BREAK && /\s/.test(source[at]) ? " " : char, at }))),
    );
  } else if (lower.some(({ char }) => /[0-9]/.test(char))) {
    // 숫자 읽기는 닉네임에만. 문장에서는 '보잉747 사자'처럼 숫자와 낱말이 우연히 이어진다.
    forms.push(...toForms(readDigits(lower), true));
  }

  // 정상 낱말 자리는 원래 글(숫자 포함·숫자 뺀 것)에서 그대로 찾는다. 뼈대로 찾으면 씨발점도 시발점이 된다.
  const allowed: [number, number][] = [];
  const allow = freeText ? TEXT_ALLOW : ALLOW;
  for (const text of [lower, letters]) {
    for (const hit of scan(encode(toPieces(text), false), allow.index)) allowed.push([hit.start, hit.end]);
    // 글자마다 한 칸씩 — 이모지처럼 두 칸짜리 글자가 있어도 자리가 어긋나지 않게 BMP 밖 글자는 한 칸으로 바꿔 둔다.
    const joined = text.map(({ char }) => (char.length === 1 ? char : " ")).join("");
    for (const { pattern, literal } of allow.shapes) {
      for (const { index } of joined.matchAll(pattern))
        allowed.push([text[index].at, text[index + literal - 1].at + 1]);
    }
  }
  const digitAt = new Set(lower.filter(({ char }) => /[0-9]/.test(char)).map(({ at }) => at));
  return { source, forms, allowed, digitAt };
}

// ── 찾기 ────────────────────────────────────────────────
function isWordEdge(units: readonly Unit[], start: number, end: number): boolean {
  const before = units[start - 1];
  const after = units[end];
  return (!before || before.script !== units[start].script) && (!after || after.script !== units[end - 1].script);
}

function* scan(
  units: readonly Unit[],
  index: PatternIndex,
): Generator<ProfanityMatch & { units: Unit[]; recount?: Pattern["recount"] }> {
  const text = units.map((unit) => unit.code).join("");
  for (let i = 0; i < units.length; i++) {
    for (const pattern of index.get(text[i]) ?? []) {
      const end = i + pattern.code.length;
      if (!text.startsWith(pattern.code, i)) continue;
      if (pattern.kind === "word" && !isWordEdge(units, i, end)) continue;
      const span = units.slice(i, end);
      yield {
        category: pattern.category,
        word: pattern.word,
        start: span[0].at,
        end: span[span.length - 1].at + 1,
        units: span,
        recount: pattern.recount,
      };
    }
  }
}

/** 영문 글자와 겹친 수: "nigger" → n1 i1 g2 e1 r1 */
function letterRuns(text: string): [string, number][] {
  const runs: [string, number][] = [];
  for (const char of text.toLowerCase().replace(/[^a-z]/g, "")) {
    const last = runs.at(-1);
    if (last?.[0] === char) last[1] += 1;
    else runs.push([char, 1]);
  }
  return runs;
}

/** 줄여서 찾은 낱말이 원래 글에도 있나. 영문은 글자마다 그만큼 이상 겹쳤나(puuussy ⊇ pussy, niger ⊉ nigger),
 * 한글은 낱말 자모가 차례대로 다 있나(네네ㅇ앰 ⊇ 네앰, 냄새 ⊉ 네앰). 낱말 끝(띄어쓰기)까지 본다. */
function recounted(
  source: string,
  { word, start, end }: ProfanityMatch,
  how: NonNullable<Pattern["recount"]>,
): boolean {
  let stop = end;
  while (stop < source.length && !/\s/.test(source[stop])) stop += 1;
  if (how === "runs") {
    const found = letterRuns(source.slice(start, stop));
    const wanted = letterRuns(word);
    return wanted.every(([char, count], i) => found[i]?.[0] === char && found[i][1] >= count);
  }
  // 자모 단위로 차례대로 있나 본다(받침 없음 부호는 뺀다). 음절로 보면 받침 미루기(주울 → 줄)를 놓친다.
  const jamo = (text: string) =>
    [...codeOf(toPieces([...text].map((char, at) => ({ char, at }))), how === "grouped")].filter(
      (code) => code !== String.fromCharCode(JONG_BASE) && code !== " ",
    );
  const found = jamo(source.slice(start, stop).toLowerCase());
  let next = 0;
  return jamo(word.normalize("NFKC")).every((wanted) => {
    next = found.indexOf(wanted, next) + 1;
    return next > 0;
  });
}

function findIn(prepared: Prepared, index: Index): ProfanityMatch | null {
  for (const form of prepared.forms) {
    const passes: Record<Form["shape"], [Unit[], PatternIndex][]> = {
      plain: [
        [form.raw, index.raw],
        [form.grouped, index.grouped],
      ],
      sounded: [[form.grouped, index.sounded]],
      collapsed: [
        [form.raw, index.collapsedRaw],
        [form.grouped, index.collapsedGrouped],
      ],
    };
    for (const [units, patterns] of passes[form.shape]) {
      for (const { units: span, recount, ...hit } of scan(units, patterns)) {
        if (recount && !recounted(prepared.source, hit, recount)) continue;
        if (form.needsLetter && span.every((unit) => prepared.digitAt.has(unit.at))) continue;
        if (prepared.allowed.some(([start, end]) => start <= hit.start && hit.end <= end)) continue;
        return hit;
      }
    }
  }
  return null;
}

/**
 * 글에서 금칙어를 하나 찾는다. 없으면 null.
 * 닉네임이 아닌 자유 글(문의·댓글)에는 freeText 를 켠다 — 띄어쓰기·문장부호를 건너뛰고 ㅅㅂ 같은 자모 축약도 본다.
 */
export function findProfanity(text: string, { freeText = true }: { freeText?: boolean } = {}): ProfanityMatch | null {
  return findIn(prepare(text.normalize("NFKC"), freeText), FORBIDDEN_INDEX);
}

// ── 닉네임 ───────────────────────────────────────────────
const ALLOWED = /^[가-힣A-Za-z0-9_]+$/;

export type NicknameProblem =
  "empty" | "tooShort" | "tooLong" | "space" | "jamo" | "characters" | "reserved" | "abusive" | "inappropriate";

/** 닉네임 칸이 반쪽 폭이라 문구는 16자 안팎으로 짧게 둔다. 걸린 낱말은 보여 주지 않는다. */
export const NICKNAME_MESSAGES: Readonly<Record<NicknameProblem, string>> = {
  empty: "닉네임을 입력해 주세요.",
  tooShort: `${NICKNAME_MIN_LENGTH}자 이상 입력해 주세요.`,
  tooLong: `${NICKNAME_MAX_LENGTH}자까지 쓸 수 있습니다.`,
  space: "띄어쓰기는 쓸 수 없습니다.",
  jamo: "자음·모음만 따로 쓸 수 없습니다.",
  characters: "특수문자는 _만 쓸 수 있습니다.",
  reserved: "운영·서비스 이름은 쓸 수 없습니다.",
  abusive: "욕설·비하 표현은 쓸 수 없습니다.",
  inappropriate: "부적절한 표현은 쓸 수 없습니다.",
};

/** 서버와 같은 순서로 다듬는다: 제어 문자는 다듬기 전에 보고, 그다음 NFKC·앞뒤 공백 제거. */
export function normalizeNickname(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .trim();
}

/** 문제 없으면 null. 화면 문구는 NICKNAME_MESSAGES 로 고른다. */
export function findNicknameProblem(raw: unknown): NicknameProblem | null {
  const original = String(raw ?? "");
  // 끝에 붙은 탭 같은 제어 문자가 trim 으로 몰래 사라지지 않게 다듬기 전에 본다.
  if (/\p{C}/u.test(original)) return "characters";
  const nickname = normalizeNickname(original);
  if (!nickname) return "empty";
  const formatProblem = findFormatProblem(nickname);
  if (formatProblem) {
    // 시@발·시 발·시시ㅣ발처럼 형식도 틀리고 욕도 든 이름은 욕설 문구가 먼저다 — 형식만 고쳐 다시 시도하지 않게.
    const hit = findProfanity(nickname, { freeText: true });
    return hit ? problemForCategory(hit.category as Category) : formatProblem;
  }
  const prepared = prepare(nickname, false);
  if (findIn(prepared, RESERVED_INDEX)) return "reserved";
  const hit = findIn(prepared, FORBIDDEN_INDEX);
  return hit ? problemForCategory(hit.category as Category) : null;
}

function findFormatProblem(nickname: string): NicknameProblem | null {
  if (nickname.length < NICKNAME_MIN_LENGTH) return "tooShort";
  if (nickname.length > NICKNAME_MAX_LENGTH) return "tooLong";
  if (/\s/.test(nickname)) return "space";
  // NFKC 뒤라 호환 자모(ㄱ)가 첫가끝 자모(ᄀ)로 바뀌어 있다. 둘 다 본다.
  if (/[ㄱ-ㅎㅏ-ㅣ\u1100-\u11ff]/.test(nickname)) return "jamo";
  if (!ALLOWED.test(nickname)) return "characters";
  return null;
}

const problemForCategory = (category: Category): NicknameProblem =>
  CATEGORY_MESSAGE[category] === "inappropriate" ? "inappropriate" : "abusive";

/** 맞으면 "", 틀리면 보여 줄 말 */
export function checkNickname(raw: unknown): string {
  const problem = findNicknameProblem(raw);
  return problem ? NICKNAME_MESSAGES[problem] : "";
}
