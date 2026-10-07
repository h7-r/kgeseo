// 새 지형 손잡이를 켰을 때 어떤 메시가 사라지고 무엇이 생기는지 이름별로 센다.
// 총 삼각형은 초목 인스턴스(1,370 만)에 바닥 교체가 묻혀, 이름별로 봐야 한다.
// 쓰는 법  node naju01/tools/check-baked-terrain.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("[새지형]")) logs.push(t);
});
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.keyboard.press("KeyT"); // 게임 시작 — 씬이 살아 있어야 계기판이 돈다
await page.waitForTimeout(2000);

const countMeshes = () =>
  page.evaluate(() => {
    const scene = window.__game?.naju?.scene;
    if (!scene) return "씬 못 찾음";
    const watched = ["ground", "path", "slope", "cliffFace", "connectorRamp", "zone.sides"];
    const counts = {};
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      let visible = o.visible,
        p = o.parent;
      while (visible && p) {
        visible = p.visible;
        p = p.parent;
      }
      if (!visible || !watched.includes(o.name)) return;
      const g = o.geometry;
      const n = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
      counts[o.name] = (counts[o.name] || 0) + n;
    });
    // 판정도 같이 잰다 — 그림만 바뀌고 발밑이 안 바뀌면 예전 병이 도진다
    const terrain = window.__game?.naju?.terrain;
    const samples = terrain
      ? [
          [40, 47],
          [36, 29],
          [22, 31],
          [46, 17],
          [61, 13],
        ]
          .map(([x, z]) => x + "," + z + "=" + terrain.groundAt(x, z).y.toFixed(2))
          .join(" ")
      : "-";
    return { ...counts, groundSamples: samples };
  });
console.log("  [옛 지형]", JSON.stringify(await countMeshes()));
await page.evaluate(() => {
  for (let i = 0; i < 4; i++)
    document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click());
});
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
for (let i = 0; i < 12; i++) {
  // GLB 가 올 때까지 기다린다
  await page.waitForTimeout(5000);
  if (logs.some((l) => l.includes("준비됨") || l.includes("못 "))) break; // 성공 「준비됨」 · 실패 「못 읽었다」「못 만들었다」
}
// SwiftShader 는 한 프레임이 3~4 초라, 로그 뒤에도 이펙트 커밋까지 몇 프레임 더 기다린다(3 초로 오판한 적 있다)
await page.waitForTimeout(20000);
console.log("  [새 지형]", JSON.stringify(await countMeshes()));
console.log(
  "  진단:",
  await page.evaluate(() => {
    const terrain = window.__game?.naju?.terrain;
    return JSON.stringify({
      hasSetHeightTable: typeof terrain?.setHeightTable,
      useBlenderTerrain: window.__game?.naju?.controls?.useBlenderTerrain,
      terrainObjectCount: window.__terrainSeen ? 1 : 1,
    });
  }),
);
console.log(
  "  손으로 끼워보기:",
  await page.evaluate(async () => {
    const terrain = window.__game?.naju?.terrain;
    if (typeof terrain?.setHeightTable !== "function") return "높이표설정이 없다";
    const before = terrain.groundAt(40, 47).y;
    const mod = await import("/src/terrain/heightTable.ts");
    const table = await mod.loadHeightTable();
    if (!table) return "표를 못 읽었다";
    terrain.setHeightTable(table);
    const after = terrain.groundAt(40, 47).y;
    return `앞 ${before.toFixed(2)} → 뒤 ${after.toFixed(2)} (표 ${table.heightAt(40, 47).toFixed(2)})`;
  }),
);
console.log("  로그:", logs.join(" | "));
await browser.close();
