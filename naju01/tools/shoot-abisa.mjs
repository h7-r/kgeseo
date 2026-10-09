// Z1 의 NPC 「아비사」를 앞·옆·전신으로 찍는다.
// 걷기 상태면 지형 이동 훅이 매 프레임 카메라를 덮어써서, 편집 부감(E → Tab)에 들어가서 찍는다.
// 쓰는 법  node naju01/tools/shoot-abisa.mjs <url> <outDir>
import { mkdirSync } from "node:fs";

import { hideHelpText, logPageErrors, openHeadless, shootAround, startGame } from "./headlessPage.mjs";

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const { browser, page } = await openHeadless({ width: 900, height: 900 });
page.on("console", (m) => {
  const text = m.text();
  if (/구운모형|아비사/.test(text)) console.log("  로그:", text.slice(0, 160));
});
logPageErrors(page);
await startGame(page, url);
await page.waitForTimeout(14000);
await page.keyboard.press("KeyE");
await page.waitForTimeout(5000);
await page.keyboard.press("Tab");
await page.waitForTimeout(6000);
await hideHelpText(page, "WASD|Leva 아래쪽");
const measured = await page.evaluate(() => {
  const naju = window.__game.naju;
  const THREE = naju.THREE;
  // 아비사는 편집기가 집도록 인스턴스 무리(이름 = 한글 무리 이름)다. people.npc 는 모형이 오기 전에만 잠깐 선다.
  let mesh = null;
  naju.scene.traverse((o) => {
    if (!mesh && (o.name === "씬1.아비사" || o.name === "people.npc")) mesh = o;
  });
  if (!mesh) return "NPC 를 못 찾음";
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const g = mesh.geometry;
  return {
    name: mesh.name,
    triangles: (g.index ? g.index.count : g.attributes.position.count) / 3,
    vertexColors: !!g.attributes.color,
    UV: !!g.attributes.uv,
    material: mesh.material?.type,
    map: !!mesh.material?.map,
    boxMinY: +box.min.y.toFixed(2),
    boxMaxY: +box.max.y.toFixed(2),
    heightM: +((box.max.y - box.min.y) * 0.3).toFixed(2),
    center: [center.x, center.y, center.z],
  };
});
if (typeof measured === "string") {
  console.log("  " + JSON.stringify(measured));
} else {
  const { center, ...summary } = measured;
  console.log("  " + JSON.stringify(summary));
  await shootAround(page, outDir, "전신_앞", center, 7.0, Math.PI * 0.15, 1.0);
  await shootAround(page, outDir, "전신_옆", center, 7.0, Math.PI * 0.65, 1.0);
  await shootAround(page, outDir, "얼굴", center, 2.2, Math.PI * 0.15, 1.6);
  await shootAround(page, outDir, "발밑", center, 4.0, Math.PI * 0.15, -1.4);
}
await browser.close();
