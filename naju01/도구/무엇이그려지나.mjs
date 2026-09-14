// 새 지형 켬/끔 에서 **무엇이 그려지는지 이름별로** 견준다.
//   총량만 보면 「15만 늘었다」까지만 알고 원인을 못 짚는다.
import { chromium } from "playwright";
const 브 = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 1280, height: 760 } });
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
for (let i = 0; i < 20; i++) {
  await 쪽.waitForTimeout(5000);
  if (await 쪽.evaluate(() => { const m = window.__NAJU?.scene?.getObjectByName("땅");
    return m && (m.geometry.index?.count ?? 0) / 3 === 128000; })) break;
}
await 쪽.waitForTimeout(15000);
const 재기 = () => 쪽.evaluate(() => {
  const N = window.__NAJU; if (!N) return null;
  const 셈 = {};
  N.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let 보임 = o.visible, p = o.parent; while (보임 && p) { 보임 = p.visible; p = p.parent; }
    if (!보임) return;
    const g = o.geometry;
    const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    const k = (o.name || "(무명)") + (o.castShadow ? "☼" : "");
    셈[k] = (셈[k] || 0) + Math.round(n);
  });
  return { 새지형: N.설정?.새지형, 셈 };
});
const 켬 = await 재기();
await 쪽.evaluate(() => { for (let i = 0; i < 4; i++) document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click()); });
await 쪽.waitForTimeout(800);
await 쪽.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
await 쪽.waitForTimeout(20000);
const 끔 = await 재기();
const 이름 = [...new Set([...Object.keys(켬.셈), ...Object.keys(끔.셈)])];
이름.sort((a, b) => (Math.abs((켬.셈[b]||0)-(끔.셈[b]||0))) - (Math.abs((켬.셈[a]||0)-(끔.셈[a]||0))));
console.log(`  새지형 켬=${켬.새지형} 끔=${끔.새지형}`);
console.log("  이름                        켬        끔       차이  (☼ = 그림자도 그린다)");
for (const n of 이름.slice(0, 16)) {
  const a = 켬.셈[n] || 0, b = 끔.셈[n] || 0;
  if (a === b) continue;
  console.log(`  ${n.padEnd(24)} ${String(a).padStart(9)} ${String(b).padStart(9)} ${String(a - b).padStart(10)}`);
}
const 합 = (o) => Object.values(o).reduce((p, q) => p + q, 0);
console.log(`  합계                     ${String(합(켬.셈)).padStart(9)} ${String(합(끔.셈)).padStart(9)} ${String(합(켬.셈)-합(끔.셈)).padStart(10)}`);
await 브.close();
