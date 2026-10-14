// ① 백엔드 비교 — 같은 입력을 화면 판정(website)과 서버 판정(backend/*.py)에 넣어 결과가 어긋나는 것을 찾는다.
// 중요한 것은 「서버는 막는데 화면은 통과」 — 화면을 믿고 제출했다가 서버에서 거절당하는 경우다.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CACHE, HERE, ROOT, loadPolicy, seeded } from "./common.mjs";

// 백엔드 nickname_policy.py 가 들고 있는 목록(그 파일에서 옮겨 적음) — 그 언저리를 꼭 시험한다.
const BACKEND_WORDS = [
  ...["admin", "administrator", "root", "system", "gm", "관리자", "운영자", "운영팀", "왜곡"],
  ...["시발", "씨발", "병신", "개새끼", "좆", "보지", "자지", "fuck", "shit", "bitch", "shitake"],
];
// 실제 이름·지명처럼 막히면 안 되는 말
const PLAIN = [
  ...["황보지은", "황보지우", "황보지민", "홍어회", "영산포홍어", "탐험가", "나주", "앙암", "조사관", "별빛", "하늘"],
  ...["kim", "lee", "player", "hunter", "badminton", "dickens", "grape", "essex", "sussex", "보지마", "자지마"],
  ...["운영", "관리", "shiba", "mod", "dev", "official", "support"],
];
const leet = (word) =>
  word
    .replace(/o/g, "0")
    .replace(/i/g, "1")
    .replace(/e/g, "3")
    .replace(/a/g, "4")
    .replace(/s/g, "5")
    .replace(/t/g, "7");

/** 닉네임·비밀번호·이메일 입력 묶음. 시드가 같으면 늘 같은 묶음이다. */
function buildCases(policy) {
  const random = seeded(12345);
  const listed = Object.values(policy.forbidden.categories)
    .flatMap((lists) => [...lists.contains, ...lists.strict, ...lists.word])
    .filter((word) => !/[ㄱ-ㅎ]/.test(word));
  const words = new Set([
    ...BACKEND_WORDS,
    ...policy.reserved.word,
    ...policy.reserved.contains,
    ...listed,
    ...policy.forbidden.allow,
    ...policy.forbidden.allowSuspended,
  ]);

  const nicknames = new Set(["", " ", "a", "가", "ab", "가나", "ㄱㄴ", "가 나", "가\t", "\t가나", "가나​", "가나!"]);
  for (const odd of ["ｇａｍｅｒ", "ＡＤＭＩＮ", "가".repeat(12), "가".repeat(13), "a".repeat(12), "a".repeat(13)]) {
    nicknames.add(odd);
  }
  for (const odd of ["😀abc", "ab_c", "__", "a__b"]) nicknames.add(odd);
  for (const word of [...words, ...PLAIN]) {
    const spread = word.split("");
    for (const variant of [word, word.toUpperCase(), leet(word), word + "1", word + "123", "1" + word, "_" + word]) {
      nicknames.add(variant);
    }
    for (const variant of [
      word + "_",
      "x" + word,
      word + "x",
      "나" + word,
      word + "님",
      spread.join("_"),
      spread.join("1"),
    ]) {
      nicknames.add(variant);
    }
  }
  const nicknameChars = [..."가나다라마바사아자차카타파하시발병신좆보지abcdefghijklmnopqrstuvwxyz"];
  nicknameChars.push(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_");
  for (let i = 0; i < 4000; i++) {
    const length = 1 + Math.floor(random.next() * 14);
    nicknames.add(Array.from({ length }, () => random.pick(nicknameChars)).join(""));
  }

  const passwordSet = new Set(["", "short1A", "Password1", "Abcdefg1", "Abcdefgh", "abcdefg1", "ABCDEFG1", "Aaa12345"]);
  for (const odd of ["Abc 12345", "Abcé12345", "Abc😀1234x", "Abcd1234", "Qwer1234!", "Xy9" + "z".repeat(125)]) {
    passwordSet.add(odd);
  }
  for (const odd of ["Xy9" + "zq".repeat(63), "Kim12345Z", "Explorer1Z", "Nadu2024!"]) passwordSet.add(odd);
  const passwordChars = [..."abcABC123!@#$%^&*()_+-=[]{}:;,.<>?/~`|가é "];
  for (let i = 0; i < 3000; i++) {
    const length = 4 + Math.floor(random.next() * 20);
    passwordSet.add(Array.from({ length }, () => random.pick(passwordChars)).join(""));
  }
  const contexts = [
    ["explorer@escape.kr", "탐험가"],
    ["kim@naver.com", "kimsu"],
    ["abc@x.io", "ab"],
    ["nadu@test.com", "Nadu"],
  ];
  const passwords = [...passwordSet].flatMap((password) =>
    contexts.map(([email, nickname]) => ({ password, email, nickname })),
  );

  const emails = new Set(["", "a@b.co", "a@b.c", "explorer@escape.kr", "user.name+tag@sub.domain.com"]);
  for (const odd of ["user..name@x.com", ".user@x.com", "user.@x.com", "user@-x.com", "user@x-.com", "us er@x.com"]) {
    emails.add(odd);
  }
  for (const odd of ["user@x", "@x.com", "user@", "a@b@c.com", "한글@x.com", "user@한글.com", "o'brien@x.com"]) {
    emails.add(odd);
  }
  emails.add("a!#$%&*+/=?^_`{|}~-@x.com");
  emails.add("user@x.co.kr");
  emails.add("user@x." + "abcdefghijklmnopqrstuvwxyz".repeat(2) + "abcdefghijk");
  for (const odd of ["a".repeat(64) + "@x.com", "a".repeat(65) + "@x.com", "a@" + "b".repeat(63) + ".com"]) {
    emails.add(odd);
  }
  emails.add("a@" + "b".repeat(64) + ".com");
  emails.add("x".repeat(250) + "@x.com");
  const emailChars = [..."abcXYZ019._%+-!#'@가 "];
  for (let i = 0; i < 3000; i++) {
    const length = 3 + Math.floor(random.next() * 25);
    const text = Array.from({ length }, () => random.pick(emailChars)).join("");
    emails.add(text);
    emails.add(text.replace(/@/g, "") + "@mail.com");
  }

  return { nicknames: [...nicknames], passwords, emails: [...emails] };
}

function runBackend(cases) {
  const input = path.join(CACHE, "parity-input.json");
  const output = path.join(CACHE, "parity-backend.json");
  fs.writeFileSync(input, JSON.stringify(cases));
  execFileSync("python3", [path.join(HERE, "backend.py"), ROOT, input, output], { stdio: "inherit" });
  return JSON.parse(fs.readFileSync(output, "utf8"));
}

export function runParity(judge) {
  const cases = buildCases(loadPolicy());
  const server = runBackend(cases);

  const screenPass = cases.nicknames.map((nickname) => judge.findNicknameProblem(nickname) === null);
  const serverOnly = cases.nicknames.filter((_, i) => !server.nicknames[i] && screenPass[i]);
  const screenOnly = {};
  cases.nicknames.forEach((nickname, i) => {
    if (server.nicknames[i] && !screenPass[i]) (screenOnly[judge.findNicknameProblem(nickname)] ??= []).push(nickname);
  });

  const passwordDiff = cases.passwords.filter(
    ({ password, email, nickname }, i) =>
      (judge.RULES.password(password, { email, nickname }) === "") !== server.passwords[i],
  );
  const emailDiff = cases.emails.filter((email, i) => (judge.RULES.email(email) === "") !== server.emails[i]);
  const trimmedEmailDiff = cases.emails.filter(
    (email, i) => (judge.RULES.email(email.trim()) === "") !== server.trimmedEmails[i],
  );

  return {
    nicknames: {
      total: cases.nicknames.length,
      serverBlocksScreenPasses: serverOnly,
      screenBlocksServerPasses: Object.fromEntries(Object.entries(screenOnly).map(([k, v]) => [k, v.length])),
    },
    passwords: { total: cases.passwords.length, different: passwordDiff.length, examples: passwordDiff.slice(0, 10) },
    emails: {
      total: cases.emails.length,
      different: emailDiff.length,
      examples: emailDiff.slice(0, 10),
      differentAfterTrim: trimmedEmailDiff.length,
      examplesAfterTrim: trimmedEmailDiff.slice(0, 10),
    },
  };
}
