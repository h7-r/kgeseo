// 기준 실행과 새 실행을 체크포인트별로 견준다.
//
//   node compare.mjs <기준폴더> <새폴더> [--noise noise.json] [--tol 0.10] [--leva-map map.json] [--json report.json]
//
// 기준폴더가 baseline/ 이면 그 안의 run1 과 noise.json 을 쓴다. 두 폴더에 leva.json 이 있으면 Leva 값도 견준다.
//
// 체크포인트마다 보는 것
//   픽셀  : 다른 픽셀 비율(%). 허용 = 잡음(기준끼리의 차이) + --tol(기본 0.10%p). 다르면 새폴더/_diff/ 에 차이 그림
//   글자  : 화면 innerText 줄 단위(추가 + / 빠짐 −). 기준끼리 숫자만 흔들린 줄(noisyLines)은 뺀다
//   저장소: localStorage·sessionStorage 키별(Leva 키는 해시)
//   오류  : pageerror·console.error 를 숫자·주소를 지운 꼴로 묶어 새로 생긴 것만
//   기타  : 주소(이름표 꼴), 탭 제목, 포인터 잠금, 기대 글자 누락
// 기준끼리도 달랐던 항목과 warnOnly 체크포인트(영상 막)는 실패가 아니라 경고로만 보인다.
// 종료 코드 0 = 전부 같음, 1 = 차이 있음.
import fs from "node:fs";
import path from "node:path";
import { compareLeva, levaProblemCount, printLeva } from "./leva-compare.mjs";
import { pixelDiff } from "./pixel-diff.mjs";
import { option } from "./suite.mjs";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--noise", "--tol", "--leva-map", "--json"]);
let [baseDir, nextDir] = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));
if (!baseDir || !nextDir) {
  console.error(
    "사용: node compare.mjs <기준폴더> <새폴더> [--noise noise.json] [--tol 0.10] [--leva-map map.json] [--json report.json]",
  );
  process.exit(2);
}
let noiseFile = option(args, "--noise", null);
if (fs.existsSync(path.join(baseDir, "run1", "summary.json"))) {
  if (!noiseFile && fs.existsSync(path.join(baseDir, "noise.json"))) noiseFile = path.join(baseDir, "noise.json");
  baseDir = path.join(baseDir, "run1");
}
const TOL = parseFloat(option(args, "--tol", "0.10"));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const noise = noiseFile ? readJson(noiseFile) : null;
const noiseOf = (name) => noise?.checkpoints?.[name] ?? {};

const checkpointNames = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => /^\d+-.*\.json$/.test(f))
    .sort()
    .map((f) => f.replace(/\.json$/, ""));

const trunc = (text, n = 160) => (text && text.length > n ? text.slice(0, n) + "…" : text);
const maskNumbers = (line) => line.replace(/\d[\d,.]*/g, "#");

function lineDiff(textA, textB) {
  const lines = (text) =>
    (text ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  const a = lines(textA);
  const b = lines(textB);
  const count = (list) => {
    const bag = new Map();
    for (const x of list) bag.set(x, (bag.get(x) ?? 0) + 1);
    return bag;
  };
  const ca = count(a);
  const cb = count(b);
  const removed = [];
  const added = [];
  for (const [line, n] of ca) for (let i = 0; i < n - (cb.get(line) ?? 0); i++) removed.push(line);
  for (const [line, n] of cb) for (let i = 0; i < n - (ca.get(line) ?? 0); i++) added.push(line);
  const sameLinesOtherOrder = !removed.length && !added.length && a.join("\n") !== b.join("\n");
  return { removed, added, sameOrder: sameLinesOtherOrder };
}

function objectDiff(a = {}, b = {}) {
  const out = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = JSON.stringify(a[key]);
    const vb = JSON.stringify(b[key]);
    if (va !== vb)
      out.push({
        key,
        old: a[key] === undefined ? "(없음)" : trunc(va),
        new: b[key] === undefined ? "(없음)" : trunc(vb),
      });
  }
  return out;
}

// 하네스 환경에서만 나는 소리 — HMR 을 끈 vite 웹소켓, 하네스가 막은 외부 요청
const HARNESS_NOISE =
  /WebSocket connection to 'ws:\/\/(localhost|127\.0\.0\.1)|\[vite\]|ERR_BLOCKED_BY_CLIENT|Failed to send error to Vite server/;
const normalizeError = (text) =>
  text
    .replace(/https?:\/\/[^\s)]+/g, "<url>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 200);

function errorBag(logs = []) {
  const bag = new Map();
  for (const log of logs) {
    if ((log.kind !== "pageerror" && log.kind !== "console.error") || HARNESS_NOISE.test(log.text)) continue;
    const key = `${log.kind}: ${normalizeError(log.text)}`;
    bag.set(key, (bag.get(key) ?? 0) + 1);
  }
  return bag;
}

const bagExcess = (a, b) =>
  [...a].filter(([k, n]) => n > (b.get(k) ?? 0)).map(([k, n]) => `${k} ×${n - (b.get(k) ?? 0)}`);

function compareCheckpoint(name) {
  const result = { name, status: "ok", problems: [] };
  const a = readJson(path.join(baseDir, name + ".json"));
  const b = readJson(path.join(nextDir, name + ".json"));
  const nz = noiseOf(name);
  const warn = (message) => (result.warnings ??= []).push(message);
  // 기준끼리도 달랐던 항목은 경고로만
  const report = (noisy, message) => (noisy ? warn(message) : result.problems.push(message));
  result.desc = a.desc;

  const px = pixelDiff(
    path.join(baseDir, name + ".png"),
    path.join(nextDir, name + ".png"),
    path.join(nextDir, "_diff", name + ".png"),
  );
  result.pixelPct = px.pct;
  result.noisePct = nz.pixelPctMax ?? nz.pixelPct ?? 0;
  result.allowPct = result.noisePct + TOL;
  if (px.pct === null || px.pct > result.allowPct)
    result.problems.push(
      `픽셀 ${px.pct?.toFixed(3)}% > 허용 ${result.allowPct.toFixed(3)}% (잡음 ${result.noisePct.toFixed(3)}%)` +
        (px.note ? " " + px.note : ""),
    );

  const text = lineDiff(a.text, b.text);
  // 계기판의 「삼각형 N」처럼 기준끼리 숫자만 흔들린 줄은 빼고 본다
  if (nz.noisyLines?.length) {
    const noisy = new Set(nz.noisyLines);
    const isNoisy = (line) => noisy.has(maskNumbers(line));
    const ignored = text.removed.filter(isNoisy).length + text.added.filter(isNoisy).length;
    text.removed = text.removed.filter((x) => !isNoisy(x));
    text.added = text.added.filter((x) => !isNoisy(x));
    if (ignored) result.ignoredNoisyLines = ignored;
  }
  if (text.removed.length || text.added.length) {
    result.text = text;
    const wholeTextNoisy = nz.textEqual === false && !nz.noisyLines?.length;
    report(
      wholeTextNoisy,
      `글자 −${text.removed.length} +${text.added.length}` + (wholeTextNoisy ? " (기준끼리도 달랐던 곳)" : ""),
    );
  } else if (text.sameOrder) result.problems.push("글자 줄 순서가 다름");

  const storage = [
    ...objectDiff(a.storage?.local, b.storage?.local).map((x) => ({ ...x, area: "local" })),
    ...objectDiff(a.storage?.session, b.storage?.session).map((x) => ({ ...x, area: "session" })),
  ];
  if (storage.length) {
    result.storage = storage;
    report(nz.storageEqual === false, `저장소 ${storage.length}곳 다름`);
  }

  for (const key of ["url", "title", "pointerLocked"])
    if (a[key] !== b[key]) result.problems.push(`${key}: ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
  if (b.missing?.length) result.problems.push(`기대 글자 없음: ${JSON.stringify(b.missing)}`);

  const errorsA = errorBag(a.logs);
  const errorsB = errorBag(b.logs);
  const newErrors = bagExcess(errorsB, errorsA);
  const goneErrors = bagExcess(errorsA, errorsB);
  if (newErrors.length) {
    result.newErrors = newErrors;
    report(nz.errorsEqual === false, `새 오류 ${newErrors.length}종`);
  }
  if (goneErrors.length) result.goneErrors = goneErrors;

  // 영상 막처럼 진짜 시간에 묶인 화면은 무엇이 달라도 경고로만
  if (a.warnOnly && result.problems.length) {
    for (const problem of result.problems) warn("(영상·경고만) " + problem);
    result.problems = [];
  }
  if (result.problems.length) result.status = "diff";
  return result;
}

// ── 체크포인트 ──
const report = {
  baseline: baseDir,
  candidate: nextDir,
  tol: TOL,
  noise: noiseFile,
  checkpoints: [],
  leva: null,
  summary: {},
};
const nextNames = new Set(checkpointNames(nextDir));
let failures = 0;
for (const name of checkpointNames(baseDir)) {
  const result = nextNames.has(name)
    ? compareCheckpoint(name)
    : { name, status: "missing", problems: ["새 실행에 이 체크포인트가 없다(도달 못 함)"] };
  if (result.status !== "ok") failures++;
  report.checkpoints.push(result);
}

// ── Leva ──
const levaBase = [path.join(baseDir, "leva.json"), path.join(baseDir, "..", "leva.json")].find((f) => fs.existsSync(f));
const levaNext = path.join(nextDir, "leva.json");
if (levaBase && fs.existsSync(levaNext))
  report.leva = compareLeva(readJson(levaBase), readJson(levaNext), option(args, "--leva-map", null));

// ── 출력 ──
const pad = (text, n) => (text + " ".repeat(n)).slice(0, n);
const fixed = (n) => (n == null ? "-" : n.toFixed(3));
console.log(
  `기준: ${baseDir}\n비교: ${nextDir}\n허용: 잡음 + ${TOL}%p ${noiseFile ? `(잡음 ${noiseFile})` : "(잡음 파일 없음 → 0)"}\n`,
);
console.log(`${pad("체크포인트", 40)} ${pad("픽셀%", 8)} ${pad("허용%", 8)} 판정`);
for (const r of report.checkpoints) {
  let verdict = "✖ " + r.problems.join(" · ");
  if (r.status === "ok") verdict = r.warnings ? `✔ (경고: ${r.warnings.join(" · ")})` : "✔";
  else if (r.status === "missing") verdict = "✖ 없음";
  console.log(`${pad(r.name, 40)} ${pad(fixed(r.pixelPct), 8)} ${pad(fixed(r.allowPct), 8)} ${verdict}`);
  for (const line of r.text?.removed.slice(0, 5) ?? []) console.log(`      - ${trunc(line, 120)}`);
  for (const line of r.text?.added.slice(0, 5) ?? []) console.log(`      + ${trunc(line, 120)}`);
  for (const x of r.storage?.slice(0, 5) ?? []) console.log(`      저장소[${x.area}] ${x.key}: ${x.old} → ${x.new}`);
  for (const x of r.newErrors?.slice(0, 5) ?? []) console.log(`      새 오류 ${trunc(x, 160)}`);
}
const nextSummaryFile = path.join(nextDir, "summary.json");
const nextSummary = fs.existsSync(nextSummaryFile) ? readJson(nextSummaryFile) : null;
if (nextSummary?.failure)
  console.log(`\n새 실행이 단계 ${nextSummary.failure.step} 에서 멈춤: ${nextSummary.failure.message.split("\n")[0]}`);
if (report.leva) {
  printLeva(report.leva, trunc);
  if (levaProblemCount(report.leva)) failures++;
}

const ok = report.checkpoints.filter((r) => r.status === "ok").length;
report.summary = {
  checkpoints: report.checkpoints.length,
  ok,
  differ: report.checkpoints.length - ok,
  levaProblems: report.leva ? levaProblemCount(report.leva) : null,
};
console.log(
  `\n결과: 체크포인트 ${ok}/${report.checkpoints.length} 같음` +
    (report.leva ? ` · Leva 문제 ${report.summary.levaProblems}건` : "") +
    ` · 차이 그림: ${path.join(nextDir, "_diff")}`,
);
fs.writeFileSync(option(args, "--json", path.join(nextDir, "compare-report.json")), JSON.stringify(report, null, 1));
process.exit(failures ? 1 : 0);
