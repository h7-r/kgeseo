// 이미 구운 표본 JSON 의 삼각형을 줄인다.
//   node tools/decimate-models.mjs              기본표 그대로 전부
//   node tools/decimate-models.mjs bush2 900    하나만, 목표 900
//   node tools/decimate-models.mjs --restore    보관본(감면 전 원본)으로 되돌린다
//
// 풀·나무·바위의 GLB 는 저장소에 없지만 구운 JSON 에 위치·인덱스와 규약이 들어 있어 그걸 입력으로 줄인다.
// 새 모형을 넣을 때는 bake-model.mjs 다.
// 처음 줄일 때 감면 전 JSON 을 assets/models/archive/ 에 남긴다(git 무시). 다시 돌려도 덮지 않아
// 목표만 바꿔 다시 줄일 수 있다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compactVertices, normalizeToRule, toBase64, weldVertices } from "./bakedMesh.mjs";

const NAJU_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BAKED_DIR = path.join(NAJU_ROOT, "src", "models", "baked");
const ARCHIVE_DIR = path.join(NAJU_ROOT, "assets", "models", "archive");

// 화면에서 차지하는 크기와 심기는 수로 갈랐다. 바위는 gltf-transform 으로 줄인 rock1 GLB 의 700 에 맞췄다.
const DEFAULT_TARGETS = {
  // 풀·나무 — 가장 많이 심긴다(수풀 105 · 나무 107 포기)
  bush2: 900,
  bush3: 900,
  tree2: 1800,
  tree4: 1800,
  tree5: 1800,
  tree6: 1800,
  tree7: 1800,
  weed1: 600,
  weed2: 600,
  // 꽃은 지름 0.3 m 라 11,722 삼각형이 몇 픽셀에 쓰인다
  flower1: 450,
  flower2: 450,
  rock1: 700,
  rock2: 700,
  rock3: 700,
  rock4: 700,
  rock5: 700,
  rock6: 700,
  rock7: 700,
  gravelPatch1: 600,
  // 집·소품 — 수가 적고 가까이서 크게 보인다
  thatchedHouse1: 2500,
  thatchedHouse2: 2500,
  thatchedHouse3: 2500,
  fishTrap: 1800,
  tent: 3000,
  ferryBoat: 2500,
  // 구렁이는 사건의 주인공이라 눈앞에서 크게 본다
  serpent: 8000,
};

const args = process.argv.slice(2);

if (args[0] === "--restore") {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    console.error("보관본이 없다 — 되돌릴 것이 없다.");
    process.exit(1);
  }
  let restored = 0;
  // src 에 없는 모형(아무도 안 쓰는 것)은 보관본만 남기고 되살리지 않는다
  for (const file of fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".json"))) {
    if (!fs.existsSync(path.join(BAKED_DIR, file))) continue;
    fs.copyFileSync(path.join(ARCHIVE_DIR, file), path.join(BAKED_DIR, file));
    restored++;
  }
  console.log(`되돌렸다 — ${restored} 개.`);
  process.exit(0);
}

const jobs =
  args.length >= 2
    ? { [args[0]]: Number(args[1]) }
    : args.length === 1
      ? { [args[0]]: DEFAULT_TARGETS[args[0]] }
      : DEFAULT_TARGETS;

for (const [name, target] of Object.entries(jobs)) {
  if (!Number.isFinite(target) || target <= 0) {
    console.error(`${name}: 목표가 이상하다 (${target})`);
    process.exit(1);
  }
}

const { MeshoptSimplifier } = await import("meshoptimizer");
await MeshoptSimplifier.ready;

const decodeBase64 = (base64, ArrayType) => {
  const bytes = Buffer.from(base64, "base64");
  return new ArrayType(bytes.buffer, bytes.byteOffset, bytes.byteLength / ArrayType.BYTES_PER_ELEMENT);
};

fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

let trianglesBefore = 0;
let trianglesAfter = 0;
const lines = [];

for (const [name, target] of Object.entries(jobs)) {
  const file = path.join(BAKED_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    console.error(`  ${name}.json 가 없다 — 건너뛴다`);
    continue;
  }
  // 처음 줄일 때만 보관본을 남긴다
  const archive = path.join(ARCHIVE_DIR, `${name}.json`);
  if (!fs.existsSync(archive)) fs.copyFileSync(file, archive);

  // 언제나 보관본에서 줄인다 — 줄인 것을 또 줄이면 형태가 무너진다
  const originalText = fs.readFileSync(archive, "utf8");
  const original = JSON.parse(originalText);

  const positions0 = decodeBase64(original.positions, Float32Array);
  const indices0 = decodeBase64(original.indices, Uint16Array);
  const originalTriangles = indices0.length / 3;
  trianglesBefore += originalTriangles;

  if (originalTriangles <= target) {
    console.log(`  ${name}: 이미 ${originalTriangles} ≤ ${target} — 그대로 둔다`);
    trianglesAfter += originalTriangles;
    continue;
  }

  // 줄이기 전에 용접한다 — 같은 자리 꼭짓점이 여럿이면 면이 조각조각 떨어진다
  const welded = weldVertices(positions0, indices0);

  // 풀·잎은 뚫린 가장자리가 많아 LockBorder 를 걸면 목표에 한참 못 미친다. 실루엣은 오차 한계가 지킨다.
  const [simplified, error] = MeshoptSimplifier.simplify(welded.indices, welded.positions, 3, target * 3, 0.2);
  const packed = compactVertices(simplified, welded.positions);
  const vertexCount = packed.positions.length / 3;
  if (vertexCount > 65535) {
    console.error(`  ${name}: 꼭짓점 ${vertexCount} — Uint16 천장을 넘는다. 목표를 낮춰라.`);
    continue;
  }

  // 규약을 다시 맞춘다 — 줄이면 경계가 안쪽으로 들어와 「Y 폭 1」 이 0.994 쯤이 되고,
  // `키` 를 배율로 쓰는 놓는 쪽에서 심는 것마다 조금씩 작아진다
  const rule = original.rule ?? "lying";
  const centerSize = Number(original.centerSize ?? 0.8);
  const normalized = normalizeToRule(packed.positions, rule, centerSize);

  const indices = Uint16Array.from(packed.indices);
  const triangleCount = indices.length / 3;
  trianglesAfter += triangleCount;

  // 출처·굽기 명령은 새 모형을 넣을 때 필요한 정보라 그대로 옮긴다
  const model = {
    name: original.name ?? name,
    source: original.source,
    rule,
    ...(rule === "center" ? { centerSize } : {}),
    bakeCommand: original.bakeCommand,
    decimatedFrom: originalTriangles,
    size: normalized.size,
    vertexCount,
    triangleCount,
    positions: toBase64(normalized.positions),
    indices: toBase64(indices),
  };
  const text = JSON.stringify(model, null, 2) + "\n";
  fs.writeFileSync(file, text, "utf8");
  const beforeKb = (originalText.length / 1024) | 0;
  const afterKb = (text.length / 1024) | 0;
  lines.push(
    `  ${name.padEnd(14)} ${String(originalTriangles).padStart(7)} → ${String(triangleCount).padStart(6)}` +
      `  (${((1 - triangleCount / originalTriangles) * 100).toFixed(0).padStart(2)}% 줄임)` +
      `  ${String(beforeKb).padStart(5)} → ${String(afterKb).padStart(4)} KB` +
      `  오차 ${error.toFixed(4)}`,
  );
}

console.log("\n  모형              삼각형            줄인 비율        파일 크기        감면 오차");
for (const line of lines) console.log(line);
console.log(
  `\n  표본 합계  ${trianglesBefore.toLocaleString()} → ${trianglesAfter.toLocaleString()} 삼각형` +
    `  (${((1 - trianglesAfter / trianglesBefore) * 100).toFixed(0)}% 줄임)`,
);
console.log(
  "  표본 한 벌의 합이다. 씬에 심긴 수(수풀 105 · 나무 107 …)를 곱한 값은\n" +
    "  node tools/diagnose-load.mjs <주소> 로 다시 잰다.",
);
