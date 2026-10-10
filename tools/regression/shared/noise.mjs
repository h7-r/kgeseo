// 같은 코드를 두 번 이상 뜬 결과끼리 견줘 「잡음」을 잰다. compare.mjs 가 이 값을 허용치의 바탕으로 쓴다.
//
//   node noise.mjs <noise.json> <run1> <run2> [run3 …]
//
// 체크포인트마다: 픽셀 차이 %(쌍 중 최대) · 글자/저장소/오류가 같았는지 · 숫자만 흔들린 줄(noisyLines)
import fs from "node:fs";
import path from "node:path";
import { pixelDiff } from "./pixel-diff.mjs";

const [outFile, ...runs] = process.argv.slice(2);
if (!outFile || runs.length < 2) {
  console.error("사용: node noise.mjs <noise.json> <run1> <run2> [run3…]");
  process.exit(2);
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const normalizeError = (text) => text.replace(/https?:\/\/[^\s)]+/g, "<url>").replace(/\d+/g, "#");
const errorSignature = (record) =>
  record.logs
    .filter((l) => /error/.test(l.kind))
    .map((l) => normalizeError(l.text))
    .sort()
    .join("\n");
// compare 는 숫자를 가린 꼴이 같은 줄만 봐준다 — 좌표 같은 다른 줄은 그대로 견주게
const maskNumbers = (line) => line.trim().replace(/\d[\d,.]*/g, "#");
const lineSet = (text) => new Set(text.split("\n").map((x) => x.trim()));

const names = fs
  .readdirSync(runs[0])
  .filter((f) => /^\d+-.*\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
const diffDir = path.join(path.dirname(outFile), "noise-diff");

function measure(name) {
  const result = { pixelPct: 0, pixelPctMax: 0, pairs: [], textEqual: true, storageEqual: true, errorsEqual: true };
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const a = path.join(runs[i], name);
      const b = path.join(runs[j], name);
      if (!fs.existsSync(b + ".json")) {
        result.missingIn = runs[j];
        continue;
      }
      const pairDir = `${path.basename(runs[i])}-vs-${path.basename(runs[j])}`;
      result.pairs.push(+pixelDiff(a + ".png", b + ".png", path.join(diffDir, pairDir, name + ".png")).pct.toFixed(4));
      const ra = readJson(a + ".json");
      const rb = readJson(b + ".json");
      if (ra.text !== rb.text) {
        result.textEqual = false;
        const la = lineSet(ra.text);
        const lb = lineSet(rb.text);
        const noisy = new Set(result.noisyLines ?? []);
        for (const line of la) if (line && !lb.has(line)) noisy.add(maskNumbers(line));
        for (const line of lb) if (line && !la.has(line)) noisy.add(maskNumbers(line));
        result.noisyLines = [...noisy];
      }
      if (JSON.stringify(ra.storage) !== JSON.stringify(rb.storage)) result.storageEqual = false;
      if (errorSignature(ra) !== errorSignature(rb)) result.errorsEqual = false;
    }
  result.pixelPctMax = Math.max(0, ...result.pairs);
  result.pixelPct = result.pairs.length ? result.pairs.reduce((s, x) => s + x, 0) / result.pairs.length : 0;
  return result;
}

const checkpoints = Object.fromEntries(names.map((name) => [name, measure(name)]));
const entries = Object.entries(checkpoints);
const sortedPixels = entries.map(([, r]) => r.pixelPctMax).sort((a, b) => a - b);
const namesWhere = (test) => entries.filter(([, r]) => test(r)).map(([n]) => n);
const summary = {
  checkpoints: entries.length,
  pixelZero: namesWhere((r) => r.pixelPctMax === 0).length,
  pixelMedian: sortedPixels[Math.floor(sortedPixels.length / 2)] ?? 0,
  pixelMax: sortedPixels.at(-1) ?? 0,
  over01: entries.filter(([, r]) => r.pixelPctMax > 0.1).map(([n, r]) => `${n} ${r.pixelPctMax.toFixed(3)}%`),
  textDiffer: namesWhere((r) => !r.textEqual),
  storageDiffer: namesWhere((r) => !r.storageEqual),
  errorsDiffer: namesWhere((r) => !r.errorsEqual),
};
fs.writeFileSync(outFile, JSON.stringify({ runs, checkpoints, summary }, null, 2));

console.log(
  `잡음(${runs.length}회): 체크포인트 ${summary.checkpoints}개 · 픽셀 0% ${summary.pixelZero}개 · ` +
    `중앙 ${summary.pixelMedian.toFixed(4)}% · 최대 ${summary.pixelMax.toFixed(4)}%`,
);
if (summary.over01.length) console.log("  0.1% 넘는 곳:", summary.over01.join(", "));
if (summary.textDiffer.length) console.log("  글자 다른 곳:", summary.textDiffer.join(", "));
if (summary.storageDiffer.length) console.log("  저장소 다른 곳:", summary.storageDiffer.join(", "));
if (summary.errorsDiffer.length) console.log("  오류 다른 곳:", summary.errorsDiffer.join(", "));
console.log(`→ ${outFile}`);
