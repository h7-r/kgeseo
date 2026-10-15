// 닉네임·금칙어 판정 검사 — PR 에 적은 숫자를 누구나 다시 낼 수 있게.
//
//   npm run check:nickname                      세 검사 모두
//   npm run check:nickname -- --parity          ① 백엔드 비교만
//   npm run check:nickname -- --variants        ② 막아야 할 변형만(--seed 99)
//   npm run check:nickname -- --false-positives ③ 오탐만
//
// 판정 코드(website/src/lib/nicknamePolicy.ts·validation.ts)를 vite(rolldown)로 한 파일로 묶어 그대로 돌린다.
// 기준(아래 findFailures)에 못 미치면 종료 코드 1 로 끝난다 — CI·병합 전 검사에 그대로 쓸 수 있게.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";
import { CACHE, ROOT } from "./common.mjs";
import { runFalsePositives } from "./false-positives.mjs";
import { runParity } from "./parity.mjs";
import { runVariants } from "./variants.mjs";

const { values } = parseArgs({
  options: {
    parity: { type: "boolean", default: false },
    variants: { type: "boolean", default: false },
    "false-positives": { type: "boolean", default: false },
    seed: { type: "string", default: "99" },
  },
});
const runAll = !values.parity && !values.variants && !values["false-positives"];

/** 판정 코드를 .cache/judge.mjs 로 묶어 불러온다. */
async function loadJudge() {
  const entry = path.join(CACHE, "entry.ts");
  const source = (file) => JSON.stringify(path.join(ROOT, "website/src/lib", file));
  fs.writeFileSync(
    entry,
    `export { findNicknameProblem, findProfanity } from ${source("nicknamePolicy.ts")};\n` +
      `export { RULES } from ${source("validation.ts")};\n`,
  );
  await build({
    configFile: false,
    // 저장소 public/(모델·소리)을 .cache 로 복사하지 않게
    publicDir: false,
    logLevel: "warn",
    resolve: { alias: { "@": path.join(ROOT, "website/src") } },
    build: {
      outDir: CACHE,
      emptyOutDir: false,
      minify: false,
      lib: { entry, formats: ["es"], fileName: () => "judge.mjs" },
    },
  });
  return import(`${pathToFileURL(path.join(CACHE, "judge.mjs"))}?at=${Date.now()}`);
}

async function stage(name, run) {
  const started = performance.now();
  console.log(`\n▶ ${name}`);
  const result = await run();
  const seconds = (performance.now() - started) / 1000;
  console.log(`  (${seconds.toFixed(1)}초)`);
  return { ...result, seconds: Number(seconds.toFixed(1)) };
}

function printParity({ backendErrors, nicknames, passwords, emails }) {
  if (backendErrors.length) {
    console.log(`  백엔드 판정 실행 오류 ${backendErrors.length}건(거절로 세지 않음):`);
    for (const { check, input, error } of backendErrors.slice(0, 10))
      console.log(`    ${check} ${JSON.stringify(input)} → ${error}`);
  }
  const leaks = nicknames.serverBlocksScreenPasses;
  console.log(
    `  닉네임 ${nicknames.total}개 — 서버는 막는데 화면은 통과: ${leaks.length}개(알려진 예외 밖 ${nicknames.unexpectedServerOnly.length}개)`,
  );
  if (leaks.length) console.log(`    ${leaks.slice(0, 40).join(" ")}${leaks.length > 40 ? " …" : ""}`);
  const screenOnly = Object.entries(nicknames.screenBlocksServerPasses).map(([k, v]) => `${k} ${v}`);
  console.log(`  화면만 막음(서버 목록보다 넓은 것): ${screenOnly.join(", ")}`);
  console.log(`  비밀번호 ${passwords.total}개 — 결과 다름 ${passwords.different}개`);
  console.log(
    `  이메일 ${emails.total}개 — 결과 다름 ${emails.different}개, 앞뒤 공백을 뗀 전송 값 기준 ${emails.differentAfterTrim}개`,
  );
}

function printVariants(result) {
  console.log(`  기본형 ${result.bases}개(조합 ${result.composed}) → 변형 ${result.total}개, 시드 ${result.seed}`);
  console.log(`  자유 글 막힘 ${result.freeText.blocked}/${result.total} (${result.freeText.percent}%)`);
  console.log(`  닉네임 막힘 ${result.nickname.blocked}/${result.total} (${result.nickname.percent}%)`);
  for (const [how, row] of Object.entries(result.byHow)) {
    console.log(`    ${how}: ${row.total} / 자유 글 ${row.freeText} / 닉네임 ${row.nickname}`);
  }
  for (const [label, misses] of [
    ["자유 글 통과", result.freeText.misses],
    ["닉네임 통과", result.nickname.misses],
  ]) {
    if (misses.length) console.log(`  ${label}: ${misses.slice(0, 20).join(" / ")}`);
  }
}

function printFalsePositives({ names, words, traps, sentences, labeledSentences, skipped }) {
  console.log(`  이름 ${names.total}개 — 걸림 ${names.hits} (${names.percent}%): ${names.list.join(" ")}`);
  console.log(
    `    예상 밖(새 오탐) ${names.unexpected.length}개${names.unexpected.length ? ": " + names.unexpected.join(" ") : ""}`,
  );
  for (const [name, row] of Object.entries(words ?? {})) {
    console.log(`  낱말 ${name} ${row.total}개 — 걸림 ${row.hits} (${row.percent}%)`);
  }
  console.log(
    `  함정 문장 ${traps.total}개 — 걸림 ${traps.hits.length}${traps.hits.length ? ": " + traps.hits.join(" / ") : ""}`,
  );
  console.log(`  정상 문장 ${sentences.total}개 — 걸림 ${sentences.hits} (${sentences.percent}%)`);
  for (const hit of sentences.list.slice(0, 10)) console.log(`    ${hit}`);
  if (labeledSentences) {
    const { clean, curse } = labeledSentences;
    console.log(`  욕설 표시 문장: 정상 ${clean.total}개 중 걸림 ${clean.hits} (${clean.percent}%)`);
    console.log(`                  욕 ${curse.total}개 중 잡음 ${curse.caught} (${curse.percent}%)`);
  }
  if (skipped.length) console.log(`  건너뜀(말뭉치를 받지 못함): ${skipped.join(", ")}`);
}

/**
 * 통과 기준. 말뭉치에 따라 바뀌는 비율(외부 낱말·합성 문장·욕설 표시 문장)은 참고로만 보이고 기준에 넣지 않는다.
 */
function findFailures({ parity, variants, falsePositives }) {
  const failures = [];
  if (parity) {
    if (parity.backendErrors.length) failures.push(`백엔드 판정 실행 오류 ${parity.backendErrors.length}건`);
    if (parity.nicknames.unexpectedServerOnly.length)
      failures.push(`서버만 막는 닉네임(알려진 예외 밖) ${parity.nicknames.unexpectedServerOnly.length}건`);
    if (parity.passwords.different) failures.push(`비밀번호 판정 차이 ${parity.passwords.different}건`);
    if (parity.emails.differentAfterTrim)
      failures.push(`이메일 판정 차이(전송 값) ${parity.emails.differentAfterTrim}건`);
  }
  if (variants) {
    const missed = (row) => variants.total - row.blocked;
    if (missed(variants.freeText)) failures.push(`자유 글에서 놓친 변형 ${missed(variants.freeText)}건`);
    if (missed(variants.nickname)) failures.push(`닉네임에서 놓친 변형 ${missed(variants.nickname)}건`);
  }
  if (falsePositives) {
    if (falsePositives.names.unexpected.length)
      failures.push(`이름 새 오탐 ${falsePositives.names.unexpected.length}건`);
    if (falsePositives.traps.hits.length) failures.push(`함정 문장 오탐 ${falsePositives.traps.hits.length}건`);
  }
  return failures;
}

const started = performance.now();
fs.mkdirSync(CACHE, { recursive: true });
const judge = await loadJudge();
const report = { at: new Date().toISOString(), stages: {} };

if (runAll || values.parity) {
  report.stages.parity = await stage("① 백엔드 비교", () => runParity(judge));
  printParity(report.stages.parity);
}
if (runAll || values.variants) {
  report.stages.variants = await stage("② 막아야 할 변형", () => runVariants(judge, Number(values.seed)));
  printVariants(report.stages.variants);
}
if (runAll || values["false-positives"]) {
  report.stages.falsePositives = await stage("③ 오탐", () => runFalsePositives(judge));
  printFalsePositives(report.stages.falsePositives);
}

report.seconds = Number(((performance.now() - started) / 1000).toFixed(1));
report.failures = findFailures(report.stages);
fs.writeFileSync(path.join(CACHE, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n전체 ${report.seconds}초 · 자세한 결과: ${path.relative(ROOT, path.join(CACHE, "report.json"))}`);
if (report.failures.length) {
  console.log(`\n✖ 기준 미달 ${report.failures.length}건`);
  for (const failure of report.failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\n✔ 모든 기준 통과");
}
