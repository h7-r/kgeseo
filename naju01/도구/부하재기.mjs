// 옛 지형 / 새 지형의 **그리는 양**을 견준다.
//   ※ 헤드리스는 SwiftShader라 fps 는 의미가 없다. 삼각형·드로우콜·
//     그림자에 들어가는 양만 잰다 — 그게 실제 기기의 부하를 가른다.
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
  const N = window.__NAJU; if (!N) return "창구 없음";
  let 삼 = 0, 그림자삼 = 0, 메시 = 0;
  N.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let 보임 = o.visible, p = o.parent; while (보임 && p) { 보임 = p.visible; p = p.parent; }
    if (!보임) return;
    const g = o.geometry;
    const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
    삼 += n; 메시++;
    if (o.castShadow) 그림자삼 += n;
  });
  return { 메시, 삼각형: Math.round(삼), "그림자로 다시 그리는 삼각형": Math.round(그림자삼),
    드로우콜: N.gl.info.render.calls };
});
console.log("  켬:", JSON.stringify(await 재기()));
await 쪽.evaluate(() => { for (let i = 0; i < 4; i++) document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click()); });
await 쪽.waitForTimeout(800);
await 쪽.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());  // 새지형 끄기
await 쪽.waitForTimeout(20000);
console.log("  끔:", JSON.stringify(await 재기()));
await 브.close();
