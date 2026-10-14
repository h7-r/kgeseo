// ③ 오탐 — 막히면 안 되는 말이 얼마나 막히는지.
//   이름(성 × 이름 조합) · 정상 문장(함정 문장 + 자막 낱말로 만든 문장) · 외부 말뭉치(낱말 5만·욕설 표시 문장)
// 외부 말뭉치는 라이선스 때문에 저장소에 넣지 않고 실행 때 받아 .cache 에 둔다. 못 받으면 그 부분만 건너뛴다.
import fs from "node:fs";
import path from "node:path";
import { CACHE, percent, seeded } from "./common.mjs";

const CORPORA = {
  ko: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ko/ko_50k.txt",
  en: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt",
  curse: "https://raw.githubusercontent.com/2runo/Curse-detection-data/master/dataset.txt",
};

const SURNAMES = [
  ..."김 이 박 최 정 강 조 윤 장 임 한 오 서 신 권 황 안 송 전 홍 유 고 문 양 손 배 백 허 남 심 노 하 곽 성 차 주".split(
    " ",
  ),
  ..."우 구 민 류 나 진 지 엄 채 원 천 방 공 현 함 변 염 여 추 도 소 석 선 설 마 길 연 위 표 명 기 반 왕 금".split(" "),
  ..."옥 육 인 맹 제 모 탁 국 어 은 편 용 예 경 봉 사 부 황보 남궁 제갈 선우 독고".split(" "),
];
// 흔한 이름 + 금칙어와 한 끗 차이인 이름(미진·병철·신발·세기·문재·근혜 …)
const GIVEN =
  `민수 지은 서준 서연 하준 지우 도윤 서윤 시우 하은 주원 지민 예준 수아 지호 지아 준서 하윤 건우 민서 현우 채원
우진 윤서 선우 지유 연우 다은 유준 예은 정우 수빈 승우 은서 승현 소윤 준혁 예린 시윤 지원 이준 채은 민준 유진 성민 미진 미정
영희 철수 영수 순자 영자 정숙 경숙 상철 성기 성진 종훈 동현 진혁 재석 태호 병철 병수 병진 신영 시현 시영 보람 보은 보영 자영
재희 지현 수진 혜진 은지 은정 은영 지훈 세훈 성훈 상민 상현 정민 정훈 재민 준기 준영 승민 승기 동욱 동민 기범 태민 민호 민혁
시원 시찬 신애 자경 미숙 명숙 말순 복순 춘자 옥자 순희 경희 정희 미경 경미 종국 종석 한별 한솔 한결 한빛 다솜 새롬 새봄 새벽
보미 보라 나래 아름 초롱 슬기 사랑 하늘 바다 별 신발 세기 문재 근혜 명박 무현 대중 영삼 종남 한남 유니`.split(/\s+/);
// 사용자 결정으로 막아 둔 실제 이름(염병 + 철·수·진). 이 밖의 이름이 걸리면 새 오탐이다.
const EXPECTED_NAME_HITS = new Set(["염병철", "염병수", "염병진"]);

// 한 끗 차이로 걸리기 쉬운 정상 문장
const TRAPS = [
  ...[
    "시원한 발",
    "시장 발표",
    "병원 신관",
    "다시 이발했다",
    "시인 발표회",
    "씨앗을 심었다",
    "기이한 일",
    "미이라 전시",
  ],
  ...[
    "자아 실현",
    "우유 한 잔",
    "아이 이름",
    "오오 대단해",
    "시시한 영화",
    "하하하 웃겼다",
    "이이제이 전략",
    "지지 않겠다",
  ],
  ...[
    "기기 점검",
    "새 새끼줄",
    "개개인의 문제",
    "시이소 타기",
    "보오 하고 울었다",
    "가방 아래",
    "이발소 가자",
    "시바견 산책",
  ],
  ...["병시 이야기", "씨입니다", "자야지", "시스템에", "냄새 나", "양치질 하자", "지칠 때"],
];

async function fetchCorpus(name) {
  const file = path.join(CACHE, `${name}.txt`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  try {
    const response = await fetch(CORPORA[name], { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    fs.writeFileSync(file, text);
    return text;
  } catch (error) {
    console.warn(`  · ${name} 말뭉치를 받지 못해 건너뜁니다(${error.message}): ${CORPORA[name]}`);
    return null;
  }
}

const wordsOf = (text, pattern) =>
  text
    .split("\n")
    .map((line) => line.split(" ")[0])
    .filter((word) => pattern.test(word));

/** 닉네임으로 넣었을 때 막힌 것(길이 초과는 빼고) */
function nicknameHits(judge, list) {
  return list
    .filter((word) => {
      const problem = judge.findNicknameProblem(word);
      return problem && problem !== "tooLong";
    })
    .map((word) => {
      const match = judge.findProfanity(word, { freeText: false });
      return match ? `${word}[${match.word}]` : `${word}[${judge.findNicknameProblem(word)}]`;
    });
}

const summarize = (list, hits) => ({
  total: list.length,
  hits: hits.length,
  percent: percent(hits.length, list.length),
});

export async function runFalsePositives(judge) {
  const result = { skipped: [] };

  // 황보+미 와 황+보미 처럼 겹치는 이름은 한 번만
  const names = [...new Set(SURNAMES.flatMap((surname) => GIVEN.map((given) => surname + given)))];
  const nameHits = nicknameHits(judge, names);
  const unexpected = nameHits.filter((hit) => !EXPECTED_NAME_HITS.has(hit.split("[")[0]));
  result.names = { ...summarize(names, nameHits), list: nameHits, unexpected };

  const [ko, en, curse] = await Promise.all(["ko", "en", "curse"].map(fetchCorpus));
  for (const [name, text] of Object.entries({ ko, en, curse })) if (!text) result.skipped.push(name);

  // 낱말 5만(자막 빈도 목록)과 낱말 둘을 이어 붙인 닉네임형. 원래 욕도 섞여 있어 걸린 것을 사람이 보고 판단한다.
  if (ko && en) {
    const random = seeded(7);
    const koWords = wordsOf(ko, /^[가-힣]{2,12}$/);
    const enWords = wordsOf(en, /^[a-z]{2,12}$/);
    const join = (top, count) => {
      const out = new Set();
      for (let i = 0; i < count; i++) {
        const word = random.pick(top) + random.pick(top);
        if (word.length <= 12) out.add(word);
      }
      return [...out];
    };
    const koCombos = join(koWords.slice(0, 3000), 20000);
    const enCombos = join(enWords.slice(0, 3000), 10000);
    result.words = {};
    for (const [name, list] of Object.entries({ ko: koWords, en: enWords, koCombos, enCombos })) {
      const hits = nicknameHits(judge, list);
      result.words[name] = { ...summarize(list, hits), list: hits };
    }
  }

  // 정상 문장: 함정 문장 + 자막 낱말 4~8개를 띄어 이은 문장 5천(욕이 든 낱말은 미리 뺌)
  const sentences = [...TRAPS];
  if (ko) {
    const random = seeded(3);
    const clean = wordsOf(ko, /^[가-힣]+$/)
      .slice(0, 5000)
      .filter((word) => !judge.findProfanity(word));
    for (let i = 0; i < 5000; i++) {
      const count = 4 + Math.floor(random.next() * 5);
      const words = Array.from({ length: count }, () => clean[Math.floor(random.next() * clean.length)]);
      sentences.push(words.join(random.next() < 0.2 ? "... " : " "));
    }
  }
  const sentenceHits = sentences.flatMap((sentence) => {
    const match = judge.findProfanity(sentence);
    return match ? [`${sentence} [${match.word}: ${sentence.slice(match.start, match.end)}]`] : [];
  });
  result.sentences = { ...summarize(sentences, sentenceHits), list: sentenceHits };

  // 욕설 여부가 표시된 문장(문장|0/1) — 정상(0) 문장 중 걸린 비율과 욕(1) 문장 중 잡은 비율
  if (curse) {
    const rows = curse
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.lastIndexOf("|")), line.slice(line.lastIndexOf("|") + 1).trim() === "1"]);
    const clean = rows.filter(([, curseWord]) => !curseWord);
    const dirty = rows.filter(([, curseWord]) => curseWord);
    const cleanHits = clean.filter(([sentence]) => judge.findProfanity(sentence)).map(([sentence]) => sentence);
    const caught = dirty.filter(([sentence]) => judge.findProfanity(sentence)).length;
    result.labeledSentences = {
      clean: { ...summarize(clean, cleanHits), examples: cleanHits.slice(0, 50) },
      curse: { total: dirty.length, caught, percent: percent(caught, dirty.length) },
    };
  }
  return result;
}
