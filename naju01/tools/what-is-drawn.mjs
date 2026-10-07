// 새 지형 켬/끔에서 무엇이 그려지는지 이름별로 견준다 — 총량만으론 원인을 못 짚는다.
// 쓰는 법  node naju01/tools/what-is-drawn.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(5000);
  if (
    await page.evaluate(() => {
      const m = window.__game?.naju?.scene?.getObjectByName("ground");
      return m && (m.geometry.index?.count ?? 0) / 3 === 128000;
    })
  )
    break;
}
await page.waitForTimeout(15000);
const measure = () =>
  page.evaluate(() => {
    const naju = window.__game?.naju;
    if (!naju) return null;
    const counts = {};
    naju.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      let visible = o.visible,
        p = o.parent;
      while (visible && p) {
        visible = p.visible;
        p = p.parent;
      }
      if (!visible) return;
      const g = o.geometry;
      const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
      const key = (o.name || "(무명)") + (o.castShadow ? "☼" : "");
      counts[key] = (counts[key] || 0) + Math.round(n);
    });
    return { useBlenderTerrain: naju.controls?.useBlenderTerrain, counts };
  });
const on = await measure();
// Leva 폴더를 다 펴고 여덟 번째 체크박스(새 지형)를 끈다
await page.evaluate(() => {
  for (let i = 0; i < 4; i++)
    document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click());
});
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
await page.waitForTimeout(20000);
const off = await measure();
const names = [...new Set([...Object.keys(on.counts), ...Object.keys(off.counts)])];
names.sort(
  (a, b) =>
    Math.abs((on.counts[b] || 0) - (off.counts[b] || 0)) - Math.abs((on.counts[a] || 0) - (off.counts[a] || 0)),
);
console.log(`  새지형 켬=${on.useBlenderTerrain} 끔=${off.useBlenderTerrain}`);
console.log("  이름                        켬        끔       차이  (☼ = 그림자도 그린다)");
for (const n of names.slice(0, 16)) {
  const a = on.counts[n] || 0,
    b = off.counts[n] || 0;
  if (a === b) continue;
  console.log(`  ${n.padEnd(24)} ${String(a).padStart(9)} ${String(b).padStart(9)} ${String(a - b).padStart(10)}`);
}
const total = (o) => Object.values(o).reduce((p, q) => p + q, 0);
console.log(
  `  합계                     ${String(total(on.counts)).padStart(9)} ${String(total(off.counts)).padStart(9)} ${String(total(on.counts) - total(off.counts)).padStart(10)}`,
);
await browser.close();
