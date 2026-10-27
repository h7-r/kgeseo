// NPC 회귀 검사 실행기 — 개발 서버에 떠 있는 나주 맵을 헤드리스 크롬으로 열고,
// 페이지 안에서 npcChecks.ts 를 불러 실제 지형·소품으로 검사한다. NajuScene 연결이 없어도 돈다.
//
//   npx.cmd vite naju01                                   (다른 창 · 5174)
//   node naju01/src/npc/checks/run-npc-checks.mjs [주소]   (기본 http://localhost:5174/)
//
// 끝나면 통과/실패 수를 찍고, 실패가 있으면 종료 코드 1 이다. --json 파일 을 주면 측정값 전체를 저장한다.
// 시스템 Chrome 을 먼저 쓰고, 없으면 Playwright 기본 Chromium(npx playwright install 로 받은 것)을 쓴다.
import { writeFileSync } from "node:fs";

import { chromium } from "playwright";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null;
const url = args.find((a, i) => !a.startsWith("--") && i !== jsonAt + 1) ?? "http://localhost:5174/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
  } catch {
    return chromium.launch({ headless: true, args: ["--mute-audio"] });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__game?.naju?.terrain && !!window.__game?.propColliders, null, {
  timeout: 240000,
});

// 구운 모형·손 배치·블렌더 높이표가 늦게 붙는다 — 소품 수와 지면 높이 표본이 6 초 동안 그대로일 때까지 기다린다
const probe = () =>
  page.evaluate(() => {
    const t = window.__game.naju.terrain;
    const heights = [];
    for (let i = 0; i < 20; i++) heights.push(t.groundAt(5 + i * 3.5, 10 + (i % 5) * 7).y.toFixed(4));
    return `${window.__game.propColliders.count}|${heights.join(",")}`;
  });
const first = await probe();
let last = first;
let since = Date.now();
for (const end = Date.now() + 120000; Date.now() < end; await sleep(1000)) {
  const now = await probe();
  if (now !== last) {
    last = now;
    since = Date.now();
  } else if (Date.now() - since > 6000) break;
}
console.log(
  `씬 준비: 소품 ${last.split("|")[0]}개 · 지면 표본 ${first === last ? "처음과 같음" : "처음과 달라짐(높이표·배치가 늦게 붙음)"}`,
);

const output = await page.evaluate(async () => {
  const { runNpcChecks } = await import("/src/npc/checks/npcChecks.ts");
  const { runDialogChecks } = await import("/src/npc/checks/dialogChecks.ts");
  const { runActivityChecks } = await import("/src/npc/checks/activityChecks.ts");
  const { runAssessmentChecks } = await import("/src/npc/checks/assessmentChecks.ts");
  const { runHelpOfferChecks } = await import("/src/npc/checks/helpOfferChecks.ts");
  const { runAiProviderChecks } = await import("/src/npc/checks/aiProviderChecks.ts");
  const { runHttpTransportChecks } = await import("/src/npc/checks/httpTransportChecks.ts");
  const { runContentSafetyChecks } = await import("/src/npc/checks/contentSafetyChecks.ts");
  const { runBehaviorEvalChecks } = await import("/src/npc/checks/behaviorEvalChecks.ts");
  const g = window.__game;
  const input = { terrain: g.naju.terrain, props: g.propColliders };
  const main = runNpcChecks(input);
  // 대화 검사(J)는 비동기 — 공급자 시간 초과 · 취소 · React 루트 정리를 기다린다
  const dialog = await runDialogChecks(input);
  // 행동 · 진행 추적(K) — 꾸민 프레임 · 이벤트만 쓴다
  const activity = runActivityChecks();
  // 상태 추정 · 도움 제안 정책(L) — 꾸민 대본만 쓴다
  const assessment = runAssessmentChecks();
  // 도움 제안 UI · 수락 · 거절(M) — 비동기
  const offer = await runHelpOfferChecks();
  // AI 대사 공급자 어댑터(N) — 가짜 전송만, 비동기
  const ai = await runAiProviderChecks();
  // HTTP 전송(O) — 모의 엔드포인트만, 비동기
  const http = await runHttpTransportChecks();
  // 콘텐츠 안전성(P) — 검사 전용 가상 콘텐츠만, 비동기
  const safety = await runContentSafetyChecks();
  // 행동 판단 평가셋 · 지표(Q) — 기준선 정확도는 측정값으로만
  const behavior = runBehaviorEvalChecks();
  return {
    results: [
      ...main.results,
      ...dialog.results,
      ...activity.results,
      ...assessment.results,
      ...offer.results,
      ...ai.results,
      ...http.results,
      ...safety.results,
      ...behavior.results,
    ],
    notes: [
      ...main.notes,
      ...dialog.notes,
      ...activity.notes,
      ...assessment.notes,
      ...offer.notes,
      ...ai.notes,
      ...http.notes,
      ...safety.notes,
      ...behavior.notes,
    ],
    measurements: {
      ...main.measurements,
      ...dialog.measurements,
      ...activity.measurements,
      ...assessment.measurements,
      ...offer.measurements,
      ...ai.measurements,
      ...http.measurements,
      ...safety.measurements,
      ...behavior.measurements,
    },
  };
});
await browser.close();

let failed = 0;
let group = "";
for (const r of output.results) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n[${group}]`);
  }
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? "통과" : "실패"}  ${r.name}${r.detail ? " — " + r.detail : ""}`);
}
if (output.notes.length) {
  console.log("\n[참고]");
  for (const n of output.notes) console.log("  " + n);
}
console.log("\n[측정]");
console.log(JSON.stringify(output.measurements.propFilter, null, 2));
console.log(JSON.stringify(output.measurements.profilerOverhead));
if (output.measurements.dialogSight) console.log(JSON.stringify(output.measurements.dialogSight));
if (output.measurements.activityCost) console.log(JSON.stringify(output.measurements.activityCost));
if (output.measurements.aiInputExample) console.log(JSON.stringify(output.measurements.aiInputExample));
for (const key of ["assessmentExample", "helpDecisionExample", "assessmentCost", "aiRequestExample"])
  if (output.measurements[key]) console.log(key, JSON.stringify(output.measurements[key]));
if (output.measurements.assessmentEval) {
  const e = output.measurements.assessmentEval;
  console.log(`assessmentEval ${e.assessor}: ${e.correct}/${e.total} · ${JSON.stringify(e.confusion)}`);
}
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(output, null, 2));
if (errors.length) console.log(`\n페이지 오류 ${errors.length}건: ${errors.slice(0, 3).join(" | ")}`);
console.log(
  `\n결과: ${output.results.length - failed}/${output.results.length} 통과${failed ? ` · 실패 ${failed}` : ""}`,
);
process.exitCode = failed || errors.length ? 1 : 0;
