// 새 지형(구운 지형) 손잡이를 켰을 때와 껐을 때 그리는 양을 견준다.
// 헤드리스 fps 는 의미가 없어 삼각형·드로우콜·그림자 양만 잰다 — 그게 실기기 부하를 가른다.
// 쓰는 법  node naju01/tools/measure-load.mjs <url>
import { expandLevaFolders, openHeadless, startGame, toggleBakedTerrain, waitForBakedGround } from "./headlessPage.mjs";

const { browser, page } = await openHeadless({ width: 1280, height: 760 });
await startGame(page, process.argv[2]);
await waitForBakedGround(page, 20);
await page.waitForTimeout(15000);
const measure = () =>
  page.evaluate(() => {
    const naju = window.__game?.naju;
    if (!naju) return "창구 없음";
    const isShown = (o) => {
      for (let node = o; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    let triangles = 0;
    let shadowTriangles = 0;
    let meshes = 0;
    naju.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || !isShown(o)) return;
      const g = o.geometry;
      const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
      triangles += n;
      meshes++;
      if (o.castShadow) shadowTriangles += n;
    });
    return {
      meshes,
      triangles: Math.round(triangles),
      shadowTriangles: Math.round(shadowTriangles),
      drawCalls: naju.gl.info.render.calls,
    };
  });
console.log("  켬:", JSON.stringify(await measure()));
await expandLevaFolders(page);
await toggleBakedTerrain(page);
await page.waitForTimeout(20000);
console.log("  끔:", JSON.stringify(await measure()));
await browser.close();
