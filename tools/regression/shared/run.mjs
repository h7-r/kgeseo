// 경로 파일을 재생하며 체크포인트마다 스크린샷·화면 글자·저장소·오류를 남긴다.
//
//   node run.mjs <묶음 game|naju> <서버주소> <출력폴더> [--route 파일] [--pages 파일] [--only 구간] [--headed] [--keep-going]
//
// 한 단계가 실패하면 실패 화면과 이유를 남기고, 그 뒤 체크포인트는 다음 newContext(새 구간)까지 「도달 못 함」으로 적는다.
import fs from "node:fs";
import path from "node:path";
import { checkpoint } from "./checkpoint.mjs";
import { bodyText, goto, launch, newSession } from "./session.mjs";
import { exec } from "./steps.mjs";
import { loadSuite, option } from "./suite.mjs";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--route", "--pages", "--only"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));
const [suiteName, baseArg, outDir] = positional;
if (!suiteName || !baseArg || !outDir) {
  console.error(
    "사용: node run.mjs <묶음 game|naju> <서버주소 http://localhost:53xx> <출력폴더> " +
      "[--route 파일] [--pages 파일] [--only 구간] [--headed] [--keep-going]",
  );
  process.exit(2);
}
const base = baseArg.replace(/\/$/, "");
const keepGoing = args.includes("--keep-going");
const onlySection = option(args, "--only", null);
const suite = loadSuite(suiteName, { route: option(args, "--route"), pages: option(args, "--pages") });
const { pages, route } = suite;

function stepUrl(step) {
  if (!step.page) return step.path;
  if (!(step.page in pages)) throw new Error(`pages.json 에 페이지 이름표 ${step.page} 가 없다`);
  return pages[step.page] + (step.query ?? "");
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const startedAt = Date.now();
const browser = await launch({ headless: !args.includes("--headed") });
let session = await newSession(browser);
const writeAttempts = [];
let fakeMsBefore = 0;
const summary = {
  base,
  suite: suite.name,
  route: path.basename(suite.routeFile),
  startedAt: new Date().toISOString(),
  checkpoints: [],
  failure: null,
  failures: [],
};
let failed = null;
let section = null;

async function runStep(step) {
  if (step.op === "storage" && step.path) {
    await session.page.goto(base + step.path, { waitUntil: "load" });
    await exec(session, step);
  } else if (step.op === "goto") {
    await goto(session, base + stepUrl(step), { readyText: step.readyText, warmMs: step.warmMs ?? 2000 });
  } else if (step.op === "newContext") {
    // 구간마다 빈 저장소·새 가짜 시계에서 시작해야 앞 구간이 뒤 구간에 영향을 주지 않는다
    writeAttempts.push(...session.writeAttempts);
    fakeMsBefore += session.fakeMs;
    await session.ctx.close();
    session = await newSession(browser);
  } else if (step.op === "checkpoint") {
    const record = await checkpoint(session, outDir, step.name, {
      expect: step.expect ?? [],
      desc: step.desc ?? "",
      warnOnly: !!step.warnOnly,
      pages,
    });
    const errors = record.logs.filter((l) => l.kind === "pageerror" || l.kind === "console.error").length;
    summary.checkpoints.push({
      name: step.name,
      desc: step.desc,
      section,
      warnOnly: !!step.warnOnly,
      status: record.missing.length ? "missing-text" : "ok",
      missing: record.missing,
      errors,
      fakeMs: record.fakeMs,
      url: record.url,
    });
    const missingNote = record.missing.length ? `  빠진 글자 ${JSON.stringify(record.missing)}` : "";
    console.log(`${record.missing.length ? "✖" : "✔"} ${step.name}${missingNote}${errors ? `  (오류 ${errors})` : ""}`);
  } else await exec(session, step);
}

for (let i = 0; i < route.steps.length; i++) {
  const step = route.steps[i];
  if (step.op === "section") {
    section = step.name;
    if (!onlySection || onlySection === section) console.log(`── ${step.name}${step.desc ? " — " + step.desc : ""}`);
    continue;
  }
  if (onlySection && onlySection !== section) continue;
  if (failed && step.op === "newContext") failed = null;
  if (failed && step.op === "checkpoint") {
    summary.checkpoints.push({ name: step.name, desc: step.desc, status: "not-reached" });
    continue;
  }
  if (failed && !keepGoing) continue;
  try {
    await runStep(step);
  } catch (error) {
    failed = { step: i, op: step, message: String(error.message || error) };
    summary.failure ??= failed;
    summary.failures.push({ ...failed, section });
    console.error(`✖ 단계 ${i} (${step.op}) 실패: ${failed.message}`);
    await session.page.screenshot({ path: path.join(outDir, `_fail-step${i}.png`) }).catch(() => {});
    fs.writeFileSync(path.join(outDir, `_fail-step${i}.txt`), `${failed.message}\n\n${await bodyText(session)}`);
    if (keepGoing) failed = null;
  }
}

writeAttempts.push(...session.writeAttempts);
summary.writeAttempts = writeAttempts;
if (writeAttempts.length) {
  console.error(`✖ 쓰기 요청 ${writeAttempts.length}건을 막았다(편집 저장 등): ${writeAttempts.join(", ")}`);
  summary.failure ??= { step: -1, message: "write attempt blocked: " + writeAttempts.join(", ") };
}
summary.leftoverLogs = session.logs.splice(0);
summary.blockedRequests = [...new Set(session.blocked)];
summary.fakeMsTotal = fakeMsBefore + session.fakeMs;
summary.realSeconds = Math.round((Date.now() - startedAt) / 1000);
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
await browser.close();

const passed = summary.checkpoints.filter((c) => c.status === "ok").length;
console.log(
  `\n체크포인트 ${passed}/${summary.checkpoints.length} 통과 · 가짜 ${Math.round(summary.fakeMsTotal / 1000)}초 · ` +
    `실제 ${summary.realSeconds}초 → ${outDir}`,
);
process.exit(summary.failure ? 1 : 0);
