// 편집 배치가 새 땅 위에 제대로 앉았는지 잰다.
// 배치 (x,z) 에서 수직 광선으로 땅 메시를 맞혀 파일의 y 와 견준다 —
// 「그림과 판정이 다른 면을 본다」를 숫자로 잡는 유일한 방법이다.
// 쓰는 법  node naju01/tools/check-placement-seating.mjs <url> <edits.json url> [new-terrain]
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 120)));
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.keyboard.press("KeyT");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  for (let i = 0; i < 4; i++)
    document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click());
});
await page.waitForTimeout(800);
if (process.argv[4] === "new-terrain") {
  await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(5000);
    if (
      await page.evaluate(
        () =>
          !!window.__game?.naju?.scene?.getObjectByName("ground")?.geometry?.attributes?.position &&
          (window.__game.naju.scene.getObjectByName("ground").geometry.index?.count ?? 0) / 3 === 128000,
      )
    )
      break;
  }
  await page.waitForTimeout(20000);
}
const result = await page.evaluate(async (editsUrl) => {
  const naju = window.__game?.naju;
  if (!naju) return "창구 없음";
  const THREE = naju.THREE,
    METER = 1 / 0.3;
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
      for (const a of Array.isArray(value) ? value : Object.values(value)) {
        if (!a || !("x" in a && "y" in a && "z" in a)) continue;
        if (a.x < 0.3 || a.x > 79.7 || a.z < 0.3 || a.z > 49.7) continue; // 코어 밖은 이 땅이 아니다
        ray.set(new THREE.Vector3(a.x * METER, 60 * METER, a.z * METER), down);
        const hits = ray.intersectObjects(groundMeshes, false);
        if (!hits.length) {
          misses++;
          continue;
        }
        gaps.push(a.y - hits[0].point.y / METER); // + 면 떠 있고 − 면 박혔다
      }
  gaps.sort((p, q) => p - q);
  const percentile = (t) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * t))];
  const absGaps = gaps.map(Math.abs).sort((p, q) => p - q);
  return {
    measured: gaps.length,
    misses: misses,
    median: +percentile(0.5).toFixed(3),
    min: +percentile(0).toFixed(2),
    max: +percentile(1).toFixed(2),
    within10cmPct: Math.round((100 * absGaps.filter((v) => v <= 0.1).length) / absGaps.length),
    within30cmPct: Math.round((100 * absGaps.filter((v) => v <= 0.3).length) / absGaps.length),
  };
}, process.argv[3]);
console.log("  " + JSON.stringify(result));
await browser.close();
