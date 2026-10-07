// 맵에 있는 것을 통짜 메시와 인스턴스 무리로 갈라 센다.
//   통짜 메시 = 코드가 그 자리에서 지오메트리를 만든 것(편집 불가)
//   인스턴스 무리 = 표본을 심은 것(편집 가능)
// 쓰는 법  node naju01/tools/count-code-meshes.mjs <url>
// 옛 페이지(window.__NAJU)에서도 돌아, 이식 전후 배치 비교에 쓸 수 있다.
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
await page.waitForTimeout(16000);
const result = await page.evaluate(() => {
  const naju = window.__game?.naju ?? window.__NAJU;
  if (!naju) return null;
  const meshes = {},
    instanced = {};
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
    const faces = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
    const name = o.name || "(무명)";
    const stats = o.isInstancedMesh ? instanced : meshes;
    stats[name] = stats[name] || { count: 0, faces: 0 };
    stats[name].count += o.isInstancedMesh ? o.count : 1;
    stats[name].faces = Math.max(stats[name].faces, faces);
  });
  const rows = (o) =>
    Object.entries(o)
      .sort((a, b) => b[1].count * b[1].faces - a[1].count * a[1].faces)
      .map(([k, v]) => `${k}|${v.count}|${v.faces}`);
  return { meshes: rows(meshes), instanced: rows(instanced) };
});
const printRows = (rows) => {
  for (const s of rows) {
    const [n, c, f] = s.split("|");
    console.log(`  ${n.padEnd(20)} ${c.padStart(4)}개 × ${Number(f).toLocaleString().padStart(9)}면`);
  }
};
if (!result) {
  console.log("창구 없음");
} else {
  console.log("== 통짜 메시(코드가 그 자리에서 만든 것 · 편집 불가) ==");
  printRows(result.meshes);
  console.log("== 인스턴스 무리(표본을 심은 것 · 편집 가능) ==");
  printRows(result.instanced);
}
await browser.close();
