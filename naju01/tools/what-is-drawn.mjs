// 새 지형 켬/끔에서 무엇이 그려지는지 이름별로 견준다 — 총량만으론 원인을 못 짚는다.
// 쓰는 법  node naju01/tools/what-is-drawn.mjs <url>
import { expandLevaFolders, openHeadless, startGame, toggleBakedTerrain, waitForBakedGround } from "./headlessPage.mjs";

const { browser, page } = await openHeadless({ width: 1280, height: 760 });
await startGame(page, process.argv[2]);
await waitForBakedGround(page, 20);
await page.waitForTimeout(15000);
const measure = () =>
  page.evaluate(() => {
    const naju = window.__game?.naju;
    if (!naju) return null;
    const isShown = (o) => {
      for (let node = o; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    const counts = {};
    naju.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || !isShown(o)) return;
      const g = o.geometry;
      const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
      const key = (o.name || "(무명)") + (o.castShadow ? "☼" : "");
      counts[key] = (counts[key] || 0) + Math.round(n);
    });
    return { useBlenderTerrain: naju.controls?.useBlenderTerrain, counts };
  });
const on = await measure();
await expandLevaFolders(page);
await toggleBakedTerrain(page);
await page.waitForTimeout(20000);
const off = await measure();
const countByName = (side, name) => side.counts[name] || 0;
const names = [...new Set([...Object.keys(on.counts), ...Object.keys(off.counts)])];
names.sort((a, b) => Math.abs(countByName(on, b) - countByName(off, b)) - Math.abs(countByName(on, a) - countByName(off, a)));
console.log(`  새지형 켬=${on.useBlenderTerrain} 끔=${off.useBlenderTerrain}`);
console.log("  이름                        켬        끔       차이  (☼ = 그림자도 그린다)");
for (const name of names.slice(0, 16)) {
  const onCount = countByName(on, name);
  const offCount = countByName(off, name);
  if (onCount === offCount) continue;
  console.log(
    `  ${name.padEnd(24)} ${String(onCount).padStart(9)} ${String(offCount).padStart(9)} ${String(onCount - offCount).padStart(10)}`,
  );
}
const sumCounts = (side) => Object.values(side.counts).reduce((sum, count) => sum + count, 0);
console.log(
  `  합계                     ${String(sumCounts(on)).padStart(9)} ${String(sumCounts(off)).padStart(9)} ${String(sumCounts(on) - sumCounts(off)).padStart(10)}`,
);
await browser.close();
