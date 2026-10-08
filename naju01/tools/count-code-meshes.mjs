// 맵에 있는 것을 통짜 메시와 인스턴스 무리로 갈라 센다.
//   통짜 메시 = 코드가 그 자리에서 지오메트리를 만든 것(편집 불가)
//   인스턴스 무리 = 표본을 심은 것(편집 가능)
// 쓰는 법  node naju01/tools/count-code-meshes.mjs <url>
import { openHeadless, startGame } from "./headlessPage.mjs";

const { browser, page } = await openHeadless({ width: 900, height: 600 });
await startGame(page, process.argv[2]);
await page.waitForTimeout(16000);
const result = await page.evaluate(() => {
  const naju = window.__game?.naju;
  if (!naju) return null;
  const isShown = (o) => {
    for (let node = o; node; node = node.parent) if (!node.visible) return false;
    return true;
  };
  const meshes = {};
  const instanced = {};
  naju.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !isShown(o)) return;
    const g = o.geometry;
    const faces = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
    const name = o.name || "(무명)";
    const stats = o.isInstancedMesh ? instanced : meshes;
    stats[name] = stats[name] || { count: 0, faces: 0 };
    stats[name].count += o.isInstancedMesh ? o.count : 1;
    stats[name].faces = Math.max(stats[name].faces, faces);
  });
  const rows = (stats) =>
    Object.entries(stats)
      .sort((a, b) => b[1].count * b[1].faces - a[1].count * a[1].faces)
      .map(([name, { count, faces }]) => [name, count, faces]);
  return { meshes: rows(meshes), instanced: rows(instanced) };
});
const printRows = (rows) => {
  for (const [name, count, faces] of rows)
    console.log(`  ${name.padEnd(20)} ${String(count).padStart(4)}개 × ${faces.toLocaleString().padStart(9)}면`);
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
