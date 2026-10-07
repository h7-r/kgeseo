// 같은 시점에서 옛 지형 / 새 지형을 각각 찍어 나란히 본다.
// 쓰는 법  node naju01/tools/screenshot-terrain.mjs <url> <outDir> [new-terrain]
// 헤드리스는 SwiftShader 라 한 프레임이 3~4 초다 — 넉넉히 기다린다.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const [url, outDir, mode] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
// 기본 헤드리스는 GL 이 없어 캔버스가 비므로 ANGLE+SwiftShader 를 명시한다
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 140)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
await page.waitForTimeout(2500);
// Leva 를 펴고, 필요하면 새지형을 켠다
await page.evaluate(() => {
  for (let i = 0; i < 4; i++)
    document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click());
});
await page.waitForTimeout(800);
if (mode === "new-terrain") {
  await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(5000);
    const ready = await page.evaluate(() => {
      const m = window.__game?.naju?.scene?.getObjectByName("ground");
      return m ? (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 === 128000 : false;
    });
    if (ready) break;
  }
  await page.waitForTimeout(20000); // 이펙트 커밋 + 몇 프레임
}
// 계기판(H 토글)·Leva·안내문을 숨겨 화면만 남긴다
await page.keyboard.press("KeyH");
await page.evaluate(() => {
  document.querySelectorAll('[class*="leva"]').forEach((e) => (e.style.display = "none"));
  [...document.querySelectorAll("div")].forEach((d) => {
    if (d.children.length === 0 && /WASD 이동|Leva 아래쪽/.test(d.textContent)) {
      let p = d;
      for (let i = 0; i < 3 && p.parentElement; i++) p = p.parentElement;
      p.style.display = "none";
    }
  });
});
const viewpoints = [
  ["구렁이_가까이", 21.2, 37.6, 2.2],
  ["구렁이_옆에서", 25.5, 40.5, -1.9],
  ["구렁이_멀리", 18, 35, 2.4],
];
for (const [name, X, Z, heading] of viewpoints) {
  await page.evaluate(([x, z, a]) => window.__game?.naju?.teleport?.current?.(x, z, a), [X, Z, heading]);
  await page.waitForTimeout(9000); // 프레임 두세 장
  // preserveDrawingBuffer 가 꺼져 Playwright 스크린샷은 검다(켜면 본편 성능 손해).
  // 같은 태스크 안에서 직접 그리고 곧바로 캔버스를 읽으면 버퍼가 살아 있다.
  const dataUrl = await page.evaluate(() => {
    const naju = window.__game?.naju;
    if (!naju) return null;
    naju.gl.render(naju.scene, naju.camera);
    return naju.gl.domElement.toDataURL("image/png");
  });
  if (!dataUrl) {
    console.log("  ★ 캔버스를 못 읽었다", name);
    continue;
  }
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("  찍음", name);
}
await browser.close();
