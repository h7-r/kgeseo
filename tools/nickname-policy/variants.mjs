// ② 막아야 할 변형 — 모든 금칙어(기본형 + compose 로 펼친 조합형)에서 우회 표기를 계산으로 만들어 전부 막히는지 본다.
//   (a) 숫자·기호·띄어쓰기·밑줄 끼움  (b) 길게 늘이기  (c) 된소리·거센소리·모음  (d) 두벌식 자판 영문  (e) 앞말 조합
import { loadPolicy, percent, seeded } from "./common.mjs";

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
const SILENT = CHO.indexOf("ㅇ");
const SIMPLE_VOWELS = "ㅏㅐㅓㅔㅗㅜㅡㅣ";

const decompose = (char) => {
  const offset = char.charCodeAt(0) - 0xac00;
  return offset < 0 || offset > 11171 ? null : [Math.floor(offset / 588), Math.floor(offset / 28) % 21, offset % 28];
};
const compose = ([cho, jung, jong]) => String.fromCharCode(0xac00 + (cho * 21 + jung) * 28 + jong);

// 두벌식 자판(대문자는 Shift 자리)
const KEYS = {
  ...{ ㅂ: "q", ㅈ: "w", ㄷ: "e", ㄱ: "r", ㅅ: "t", ㅛ: "y", ㅕ: "u", ㅑ: "i", ㅐ: "o", ㅔ: "p", ㅁ: "a", ㄴ: "s" },
  ...{ ㅇ: "d", ㄹ: "f", ㅎ: "g", ㅗ: "h", ㅓ: "j", ㅏ: "k", ㅣ: "l", ㅋ: "z", ㅌ: "x", ㅊ: "c", ㅍ: "v", ㅠ: "b" },
  ...{ ㅜ: "n", ㅡ: "m", ㅃ: "Q", ㅉ: "W", ㄸ: "E", ㄲ: "R", ㅆ: "T", ㅒ: "O", ㅖ: "P", ㅘ: "hk", ㅙ: "ho", ㅚ: "hl" },
  ...{ ㅝ: "nj", ㅞ: "np", ㅟ: "nl", ㅢ: "ml", ㄳ: "rt", ㄵ: "sw", ㄶ: "sg", ㄺ: "fr", ㄻ: "fa", ㄼ: "fq", ㄽ: "ft" },
  ...{ ㄾ: "fx", ㄿ: "fv", ㅀ: "fg", ㅄ: "qt" },
};
const typeOnKeyboard = (word) =>
  [...word]
    .map((char) => {
      const parts = decompose(char);
      if (!parts) return char;
      return KEYS[CHO[parts[0]]] + KEYS[JUNG[parts[1]]] + (parts[2] ? KEYS[JONG[parts[2]]] : "");
    })
    .join("");

const TENSE = { ㅅ: "ㅆ", ㅂ: "ㅃ", ㄱ: "ㄲ", ㄷ: "ㄸ", ㅈ: "ㅉ", ㅆ: "ㅅ", ㅃ: "ㅂ", ㄲ: "ㄱ", ㄸ: "ㄷ", ㅉ: "ㅈ" };
const ASPIRATED = { ㅂ: "ㅍ", ㄱ: "ㅋ", ㄷ: "ㅌ", ㅈ: "ㅊ" };
const VOWELS = { ㅣ: ["ㅟ", "ㅢ"], ㅐ: ["ㅔ"], ㅔ: ["ㅐ"], ㅓ: ["ㅕ"], ㅕ: ["ㅓ"], ㅗ: ["ㅛ"], ㅜ: ["ㅠ"], ㅏ: ["ㅑ"] };
const SEPARATORS = [..."0123456789.-~@#$%!*^&+=,?/ _"];
const PREFIXES = ["개", "존나", "씨발", "니미", "쌍", "개씹", "아", "진짜", "이"];

/** 기본형 + compose 규칙을 펼친 조합형 */
function baseWords(policy) {
  const bases = [];
  for (const [category, lists] of Object.entries(policy.forbidden.categories)) {
    for (const kind of ["contains", "strict", "word"])
      for (const word of lists[kind]) bases.push({ category, kind, word });
  }
  const spellings = (part) => [part, ...(policy.compose.alternates[part] ?? [])];
  for (const rule of policy.compose.rules) {
    for (const prefix of rule.prefixes.flatMap(spellings)) {
      for (const stem of rule.stems.flatMap(spellings)) {
        bases.push({ category: rule.category, kind: rule.kind, word: prefix + stem, composed: true });
      }
    }
  }
  return bases;
}

function buildCases(bases, random) {
  const cases = [];
  const add = (base, how, text) => cases.push({ ...base, how, text });
  for (const base of bases) {
    const { word, kind } = base;
    // 숫자가 낱말의 일부인 말(518탱크)에는 숫자를 끼우지 않는다 — 518 이 다른 수가 된다.
    const hasDigit = /[0-9]/.test(word);
    const filler = (n) => {
      const text = Array.from({ length: n }, () => random.pick(SEPARATORS)).join("");
      return hasDigit ? text.replace(/[0-9]/g, ".") : text;
    };
    if (/[ㄱ-ㅎㅏ-ㅣ]/.test(word)) {
      add(base, "그대로(자모)", word);
      continue;
    }
    if (/^[0-9]+$/.test(word)) {
      add(base, "그대로", word);
      continue;
    }
    const chars = [...word];
    add(base, "그대로", word);

    // (a) 끼움: 모든 틈에 1~5개, 한 틈에만 1~5개, 숫자·밑줄만
    if (chars.length > 1) {
      for (let k = 0; k < 3; k++) {
        add(base, "끼움(모든 틈)", chars.map((c, i) => (i ? filler(random.int(1, 5)) : "") + c).join(""));
        const gap = random.int(1, chars.length - 1);
        add(base, "끼움(한 틈)", chars.slice(0, gap).join("") + filler(random.int(1, 5)) + chars.slice(gap).join(""));
        const digits = [...(hasDigit ? "_" : "0123456789_")];
        const between = () => Array.from({ length: random.int(1, 5) }, () => random.pick(digits)).join("");
        add(base, "숫자·밑줄만 끼움", chars.map((c, i) => (i ? between() : "") + c).join(""));
      }
    }

    if (/^[가-힣]+$/.test(word)) {
      // (b) 늘이기: 같은 음절 반복, ㅇ+같은 모음, 낱자모, 기호, 끝 음절 받침 미루기
      if (kind !== "word") for (let k = 0; k < 3; k++) add(base, "늘이기", stretch(chars, random));
      // (c) 된소리·거센소리·모음 — 뼈대로 비교하는 contains 낱말만
      if (kind === "contains") {
        chars.forEach((char, i) => {
          const [, jung] = decompose(char);
          const cho = CHO[decompose(char)[0]];
          const swap = (change) => chars.map((c, j) => (j === i ? compose(change(decompose(c))) : c)).join("");
          if (TENSE[cho])
            add(
              base,
              "된소리",
              swap(([, v, j]) => [CHO.indexOf(TENSE[cho]), v, j]),
            );
          if (ASPIRATED[cho])
            add(
              base,
              "거센소리",
              swap(([, v, j]) => [CHO.indexOf(ASPIRATED[cho]), v, j]),
            );
          for (const vowel of VOWELS[JUNG[jung]] ?? [])
            add(
              base,
              "모음",
              swap(([c, , j]) => [c, JUNG.indexOf(vowel), j]),
            );
        });
      }
      // (d) 자판 영문
      add(base, "자판 영문", typeOnKeyboard(word));
      if (kind === "contains") add(base, "자판 영문 대문자", typeOnKeyboard(word).toUpperCase());
      // (e) 앞말 조합
      if (kind !== "word") add(base, "앞말 조합", random.pick(PREFIXES) + word + random.pick(["", "야", "들", "같은"]));
    } else if (/^[a-z0-9]+$/.test(word)) {
      add(base, "대문자", word.toUpperCase());
      const i = random.int(0, word.length - 1);
      add(base, "글자 늘임", word.slice(0, i) + word[i].repeat(random.int(2, 5)) + word.slice(i + 1));
      if (kind !== "word") add(base, "앞뒤 붙임", "xx" + word + "99");
    }
  }
  return cases;
}

function stretch(chars, random) {
  const out = [];
  chars.forEach((char, i) => {
    const [cho, jung, jong] = decompose(char);
    if (i === 0 && random.next() < 0.5) for (let r = random.int(1, 3); r--;) out.push(char);
    const last = i === chars.length - 1;
    if (last && jong && SIMPLE_VOWELS.includes(JUNG[jung]) && random.next() < 0.5 && JONG[jong] !== "ㅇ") {
      // 받침 미루기: 발 → 바아알
      const drawl = Array(random.int(0, 3)).fill(compose([SILENT, jung, 0]));
      out.push(compose([cho, jung, 0]), ...drawl, compose([SILENT, jung, jong]));
      return;
    }
    out.push(char);
    if (last) return;
    for (let r = random.int(0, 4); r--;) {
      const kind = random.pick(["rep", "vowel", "vowel", "lone", "loneC", "sym"]);
      if (kind === "rep" && !jong) out.push(char);
      else if (kind === "vowel" && SIMPLE_VOWELS.includes(JUNG[jung]) && !jong) {
        out.push(compose([SILENT, jung, random.pick([0, 21])]));
      } else if (kind === "lone") out.push(random.pick(["ㅣ", "ㅡ"]));
      else if (kind === "loneC") {
        // 낱자음은 틈의 끝에만 — 뒤 낱모음과 조합돼 다른 음절이 되지 않게
        out.push(random.pick(["ㅅ", "ㅇ"]));
        break;
      } else if (kind === "sym") out.push(random.pick(["~", "~~", "-", ".", "!"]));
    }
  });
  return out.join("");
}

/** 닉네임 칸에서 막혔나. 형식 단계에서 막혀도 막힌 것이지만, 기호가 없으면 금칙어 판정으로 막혀야 한다. */
function blockedAsNickname(judge, text) {
  const problem = judge.findNicknameProblem(text);
  const clean = /^[가-힣A-Za-z0-9_]+$/.test(text.normalize("NFKC").trim());
  // 한 글자 욕(씹·좆)은 2자 미만이라 형식에서 먼저 막힌다.
  if (!clean || problem === "tooShort") return problem !== null;
  if (problem === "tooLong") return judge.findProfanity(text, { freeText: false }) !== null;
  return ["abusive", "inappropriate", "reserved"].includes(problem);
}

export function runVariants(judge, seed) {
  const bases = baseWords(loadPolicy());
  const cases = buildCases(bases, seeded(seed));
  const byHow = {};
  const misses = { freeText: [], nickname: [] };
  for (const item of cases) {
    const row = (byHow[item.how] ??= { total: 0, freeText: 0, nickname: 0 });
    row.total += 1;
    if (judge.findProfanity(item.text)) row.freeText += 1;
    else misses.freeText.push(`${item.text} (${item.word}/${item.how})`);
    if (blockedAsNickname(judge, item.text)) row.nickname += 1;
    else misses.nickname.push(`${item.text} (${item.word}/${item.how})`);
  }
  const blockedFree = cases.length - misses.freeText.length;
  const blockedNick = cases.length - misses.nickname.length;
  return {
    seed,
    bases: bases.length,
    composed: bases.filter((base) => base.composed).length,
    total: cases.length,
    freeText: {
      blocked: blockedFree,
      percent: percent(blockedFree, cases.length),
      misses: misses.freeText.slice(0, 200),
    },
    nickname: {
      blocked: blockedNick,
      percent: percent(blockedNick, cases.length),
      misses: misses.nickname.slice(0, 200),
    },
    byHow,
  };
}
