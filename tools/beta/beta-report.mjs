// 베타 기록 집계 — 관리자 내보내기(GET /api/v1/admin/beta-events)로 받은 JSON 파일들을 읽어 수집 계획(v1.1)의 로그 지표를 만든다.
// 계산은 관리자 「베타 기록」 화면과 같은 website/src/admin/lib/betaReport.ts 를 쓴다(두 곳 숫자가 어긋나지 않게).
// node tools/beta/beta-report.mjs <출력 폴더> <내보내기.json> [내보내기2.json …] [--codes 코드.csv] [--now 2026-11-14T00:00:00Z]
// 출력: events.csv(원시) · summary.md(지표 요약) · objectives.csv(목표별 도달 · 완료 · 시간 · 실패 · 도움) · people.csv(사람별)
// 숫자는 「N명 중 M명」으로 함께 적는다. 표본이 작으면(<10) 비율 대신 사람 수만 본다(수집 계획 3절).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { buildBetaReport, collectEvents, eventsCsv, objectivesCsv, peopleCsv, summaryMarkdown } =
  await import("../../website/src/admin/lib/betaReport.ts");

const args = process.argv.slice(2);
const outDir = args.shift();
const files = [];
let codesFile = null;
let nowArg = null;
while (args.length) {
  const a = args.shift();
  if (a === "--codes") codesFile = args.shift();
  else if (a === "--now") nowArg = args.shift();
  else files.push(a);
}
if (!outDir || files.length === 0) {
  console.error(
    "사용법: node tools/beta/beta-report.mjs <출력 폴더> <내보내기.json …> [--codes 코드.csv] [--now ISO시각]",
  );
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// 파일 하나는 내보내기 응답 한 덩어리({events}) 또는 한 줄에 하나(JSON Lines)
const chunks = [];
for (const file of files) {
  const text = readFileSync(file, "utf8").trim();
  try {
    chunks.push(JSON.parse(text));
  } catch {
    for (const line of text.split("\n")) if (line.trim()) chunks.push(JSON.parse(line));
  }
}
const issuedCodes = codesFile
  ? readFileSync(codesFile, "utf8")
      .split("\n")
      .slice(1)
      .filter((l) => l.trim()).length
  : null;
const report = buildBetaReport(collectEvents(chunks), { now: nowArg ? Date.parse(nowArg) : Date.now(), issuedCodes });

writeFileSync(`${outDir}/events.csv`, eventsCsv(report));
writeFileSync(`${outDir}/people.csv`, peopleCsv(report));
writeFileSync(`${outDir}/objectives.csv`, objectivesCsv(report));
writeFileSync(`${outDir}/summary.md`, summaryMarkdown(report));
console.log(
  `${report.events.length}건 · ${report.people}명 → ${outDir}/summary.md · objectives.csv · people.csv · events.csv`,
);
