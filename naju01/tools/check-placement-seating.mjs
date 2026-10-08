// 편집 배치가 새 땅 위에 제대로 앉았는지 잰다.
// 배치 (x,z) 에서 수직 광선으로 땅 메시를 맞혀 파일의 y 와 견준다 —
// 「그림과 판정이 다른 면을 본다」를 숫자로 잡는 유일한 방법이다.
// 쓰는 법  node naju01/tools/check-placement-seating.mjs <url> <edits.json url> [new-terrain]
import { chromium } from "playwright";

import {
  expandLevaFolders,
  logPageErrors,
  startGame,
  toggleBakedTerrain,
  waitForBakedGround,
} from "./headlessPage.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
logPageErrors(page, 120);
await startGame(page, process.argv[2], 2500);
await page.waitForTimeout(1500);
await expandLevaFolders(page);
if (process.argv[4] === "new-terrain") {
  await toggleBakedTerrain(page);
  await waitForBakedGround(page, 14);
  await page.waitForTimeout(20000);
}
const result = await page.evaluate(async (editsUrl) => {
  const naju = window.__game?.naju;
  if (!naju) return "창구 없음";
  const THREE = naju.THREE;
  const METER = 1 / 0.3;
  const edits = await (await fetch(editsUrl)).json();
  const groundMeshes = [];
  naju.scene.traverse((o) => {
    if (o.isMesh && o.visible && ["ground", "path", "slope", "cliffFace", "zone.sides"].includes(o.name))
      groundMeshes.push(o);
  });
  const ray = new THREE.Raycaster();
  ray.far = 400;
  const down = new THREE.Vector3(0, -1, 0);
  const gaps = [];
  let misses = 0;
  // 편집 파일 열쇠(고침·더함)는 저장 데이터라 한글 그대로다
  for (const section of ["고침", "더함"])
    for (const value of Object.values(edits[section] ?? {}))
      for (const item of Array.isArray(value) ? value : Object.values(value)) {
        if (!item || !("x" in item && "y" in item && "z" in item)) continue;
        if (item.x < 0.3 || item.x > 79.7 || item.z < 0.3 || item.z > 49.7) continue; // 코어 밖은 이 땅이 아니다
        ray.set(new THREE.Vector3(item.x * METER, 60 * METER, item.z * METER), down);
        const hits = ray.intersectObjects(groundMeshes, false);
        if (!hits.length) {
          misses++;
          continue;
        }
        gaps.push(item.y - hits[0].point.y / METER); // + 면 떠 있고 − 면 박혔다
      }
  gaps.sort((p, q) => p - q);
  const percentile = (t) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * t))];
  const absGaps = gaps.map(Math.abs).sort((p, q) => p - q);
  return {
    measured: gaps.length,
    misses,
    median: +percentile(0.5).toFixed(3),
    min: +percentile(0).toFixed(2),
    max: +percentile(1).toFixed(2),
    within10cmPct: Math.round((100 * absGaps.filter((v) => v <= 0.1).length) / absGaps.length),
    within30cmPct: Math.round((100 * absGaps.filter((v) => v <= 0.3).length) / absGaps.length),
  };
}, process.argv[3]);
console.log("  " + JSON.stringify(result));
await browser.close();
