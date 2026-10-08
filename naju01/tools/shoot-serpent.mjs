// 구렁이 머리를 바로 앞에서 찍는다 — 눈·혀 칠이 어디 앉았는지 봐야 고친다.
// 쓰는 법  node naju01/tools/shoot-serpent.mjs <url> <outDir>
import { mkdirSync } from "node:fs";

import { hideHelpText, logPageErrors, openHeadless, shootAround, startGame } from "./headlessPage.mjs";

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const { browser, page } = await openHeadless({ width: 1000, height: 700 });
logPageErrors(page);
await startGame(page, url);
await page.waitForTimeout(16000);
// 편집 → 부감으로 들어가야 걷기가 멈춘다. 아니면 지형 이동 훅이 매 프레임 카메라를 덮어쓴다.
await page.keyboard.press("KeyE");
await page.waitForTimeout(5000);
await page.keyboard.press("Tab");
await page.waitForTimeout(6000);
await hideHelpText(page, "WASD|Leva 아래쪽");
const found = await page.evaluate(() => {
  const naju = window.__game.naju;
  const THREE = naju.THREE;
  let mesh = null;
  // 인스턴스 무리 이름은 편집 파일의 무리 이름(한글 저장값) 그대로다
  naju.scene.traverse((o) => {
    if (o.isInstancedMesh && o.name === "씬1.구렁이") mesh = o;
  });
  if (!mesh) return "구렁이를 못 찾음";
  // 「가장 높은 꼭짓점」은 또아리 고리가 더 높으면 엉뚱한 데를 잡아, 거의 검게 칠한 동공을 색으로 찾는다
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  let n = 0;
  let sum = [0, 0, 0];
  if (col)
    for (let i = 0; i < pos.count; i++) {
      if (col.getX(i) < 0.1 && col.getY(i) < 0.1 && col.getZ(i) < 0.1) {
        n++;
        sum[0] += pos.getX(i);
        sum[1] += pos.getY(i);
        sum[2] += pos.getZ(i);
      }
    }
  // 색이 입혀진 모형엔 검은 동공이 없다 — 그땐 가장 높은 꼭짓점(쳐든 머리)으로 간다
  if (!n) {
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > top) {
        top = pos.getY(i);
        sum = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      }
    }
    n = 1;
  }
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const eye = new THREE.Vector3(sum[0] / n, sum[1] / n, sum[2] / n).applyMatrix4(matrix);
  return { pupilVertices: n, eye: [eye.x, eye.y, eye.z] };
});
if (typeof found === "string") {
  console.log("  " + JSON.stringify(found));
} else {
  console.log("  " + JSON.stringify({ ...found, eye: found.eye.map((v) => +v.toFixed(2)) }));
  // 거리는 유닛(1 유닛 = 0.3 m). 머리가 26 cm 라 바짝 붙여야 5 cm 눈의 칠이 보인다.
  await shootAround(page, outDir, "머리_아주가까이", found.eye, 0.75, 1.5, 0.06);
  await shootAround(page, outDir, "머리_옆", found.eye, 1.3, 1.6, 0.12);
  await shootAround(page, outDir, "머리_반대옆", found.eye, 1.3, -1.6, 0.12);
  await shootAround(page, outDir, "몸통", found.eye, 5.0, 1.0, 1.6);
}
await browser.close();
