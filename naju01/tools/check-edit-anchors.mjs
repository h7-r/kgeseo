// 손 배치(assets/edits.json)가 아직 같은 물건에 붙어 있는지 확인한다.
// 손 편집은 「생성 순서 번호」로 물건을 가리킨다. 생성기의 반복 순서·난수 소비·개수가 바뀌면 같은 번호가
// 다른 물건을 가리키게 되는데, 화면만 봐서는 알아채기 어렵다. 그래서 편집이 걸린 번호마다 그 생성 자리의
// 좌표를 assets/edit-anchors.json 에 적어 두고, 생성기를 고친 뒤 다시 재서 비교한다.
//
// 쓰는 법 (나주 개발 서버가 떠 있어야 한다 — 예: npx vite naju01)
//   node naju01/tools/check-edit-anchors.mjs [주소]            비교만 한다(기본 http://localhost:5174/)
//   node naju01/tools/check-edit-anchors.mjs [주소] --write    지금 값을 기준으로 적는다
// --write 는 「지금 손 배치가 맞다」고 눈으로 확인한 뒤, 또는 편집기로 새로 저장한 뒤에만 쓴다.
// 이 도구는 편집 파일을 읽기만 한다 — 저장 요청은 막는다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { logPageErrors, openHeadless, startGame, waitForBakedGround } from "./headlessPage.mjs";

const args = process.argv.slice(2);
const shouldWrite = args.includes("--write");
const url = args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:5174/";
const anchorFile = new URL("../assets/edit-anchors.json", import.meta.url);

// 구운 지형이 늦게 도착하면 자리가 한 번 더 바뀐다 — 값이 이만큼 그대로일 때까지 기다린다
const STABLE_MS = 10000;
const TIMEOUT_MS = 240000;
// 좌표는 cm 로 반올림해 적으므로 그보다 큰 차이만 움직인 것으로 본다
const TOLERANCE_M = 0.011;

const { browser, page } = await openHeadless({ width: 960, height: 600 });
logPageErrors(page);
await page.route("**/__naju-edit*", (route) =>
  route.request().method() === "GET" ? route.continue() : route.abort(),
);
await startGame(page, url);
await waitForBakedGround(page, 30);

const read = () =>
  page.evaluate(() => {
    const naju = window.__game?.naju;
    if (!naju?.editAnchors) return null;
    return { anchors: naju.editAnchors(), counts: naju.generatedCounts() };
  });

let current = null;
let lastText = "";
let stableSince = Date.now();
const startedAt = Date.now();
while (Date.now() - startedAt < TIMEOUT_MS) {
  current = await read();
  const text = JSON.stringify(current);
  if (text !== lastText) {
    lastText = text;
    stableSince = Date.now();
  } else if (current && Date.now() - stableSince >= STABLE_MS) break;
  await page.waitForTimeout(1000);
}
await browser.close();

if (!current) {
  console.error("✖ __game.naju.editAnchors 가 없다 — 개발 서버 주소가 맞는지 보라");
  process.exit(2);
}

const snapshot = { counts: current.counts, anchors: current.anchors };
if (shouldWrite) {
  writeFileSync(anchorFile, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`기준을 적었다 — 편집이 걸린 자리 ${current.anchors.length}곳, 무리 ${Object.keys(current.counts).length}개`);
  process.exit(0);
}

if (!existsSync(anchorFile)) {
  console.error("✖ assets/edit-anchors.json 이 없다 — 손 배치가 맞는 상태에서 --write 로 먼저 적어라");
  process.exit(2);
}
const expected = JSON.parse(readFileSync(anchorFile, "utf8"));
const key = (anchor) => `${anchor.groupId}#${anchor.id}`;
const actualByKey = new Map(current.anchors.map((anchor) => [key(anchor), anchor]));

const moved = [];
const missing = [];
for (const anchor of expected.anchors) {
  const actual = actualByKey.get(key(anchor));
  if (!actual) {
    missing.push(anchor);
    continue;
  }
  // null 은 번호가 생성 개수를 넘었다는 뜻 — 기준 때도 그랬으면 같은 것으로 본다
  const same = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) <= TOLERANCE_M);
  if (!same(anchor.x, actual.x) || !same(anchor.z, actual.z)) moved.push({ anchor, actual });
}
const expectedKeys = new Set(expected.anchors.map(key));
const unrecorded = current.anchors.filter((anchor) => !expectedKeys.has(key(anchor)));
const countChanges = Object.entries(expected.counts).filter(([groupId, n]) => current.counts[groupId] !== n);

for (const [groupId, n] of countChanges) console.log(`  개수 바뀜  ${groupId}: ${n} → ${current.counts[groupId] ?? "없음"}`);
for (const { anchor, actual } of moved.slice(0, 40))
  console.log(`  ✖ 움직임  ${key(anchor)}: (${anchor.x}, ${anchor.z}) → (${actual.x}, ${actual.z})`);
if (moved.length > 40) console.log(`  … 그 밖 ${moved.length - 40}곳`);
for (const anchor of missing.slice(0, 20)) console.log(`  ✖ 사라짐  ${key(anchor)} — 무리가 안 섰거나 편집이 지워졌다`);
if (unrecorded.length)
  console.log(`  · 기준에 없는 새 편집 ${unrecorded.length}곳 — 손 배치가 맞는지 보고 --write 로 기준을 갱신하라`);

const broken = moved.length + missing.length;
console.log(
  broken
    ? `✖ 손 편집 ${broken}곳이 다른 자리를 가리킨다 — 생성기 순서·난수·개수 변경을 되돌리거나 손 배치를 다시 잡아야 한다`
    : `✔ 손 편집 ${expected.anchors.length}곳이 모두 같은 자리를 가리킨다`,
);
process.exit(broken ? 1 : 0);
