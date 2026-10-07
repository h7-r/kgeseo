// 옛 지형 / 새 지형의 그리는 양을 견준다.
// 헤드리스는 SwiftShader 라 fps 가 의미 없어, 삼각형·드로우콜·그림자 양만 잰다 — 그게 실기기 부하를 가른다.
// 쓰는 법  node naju01/tools/measure-load.mjs <url>
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
    if (!naju) return "창구 없음";
    let triangles = 0,
      shadowTriangles = 0,
      meshes = 0;
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
      triangles += n;
      meshes++;
      if (o.castShadow) shadowTriangles += n;
    });
    return {
      meshes: meshes,
      triangles: Math.round(triangles),
      shadowTriangles: Math.round(shadowTriangles),
      drawCalls: naju.gl.info.render.calls,
    };
  });
console.log("  켬:", JSON.stringify(await measure()));
await page.evaluate(() => {
  for (let i = 0; i < 4; i++)
    document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click());
});
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click()); // 새지형 끄기
await page.waitForTimeout(20000);
console.log("  끔:", JSON.stringify(await measure()));
await browser.close();
