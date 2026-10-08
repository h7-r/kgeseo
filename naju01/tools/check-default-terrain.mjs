// 쿼리 없이 들어갔을 때 새 지형이 기본으로 올라오는지, 배치가 그 땅에 앉는지 한 번에 잰다.
// 쓰는 법  node naju01/tools/check-default-terrain.mjs <url>
import { openHeadless, startGame, waitForBakedGround } from "./headlessPage.mjs";

const { browser, page } = await openHeadless({ width: 1280, height: 760 });
const logs = [];
page.on("console", (m) => {
  const text = m.text();
  if (text.startsWith("[새지형]")) logs.push(text);
});
page.on("pageerror", (e) => logs.push("pageerror: " + (e.message || "").slice(0, 140)));
await startGame(page, process.argv[2]);
await waitForBakedGround(page, 20);
await page.waitForTimeout(20000);
const report = await page.evaluate(() => {
  const naju = window.__game?.naju;
  if (!naju) return "창구 없음";
  const THREE = naju.THREE;
  const METER = 1 / 0.3;
  const isShown = (o) => {
    for (let node = o; node; node = node.parent) if (!node.visible) return false;
    return true;
  };
  const triangleCount = (g) => Math.round((g.index?.count ?? g.attributes.position.count) / 3);
  const groundMeshes = [];
  naju.scene.traverse((o) => {
    if (o.isMesh && isShown(o) && ["ground", "path", "slope", "cliffFace", "zone.sides"].includes(o.name))
      groundMeshes.push(o);
  });
  // 땅 한복판에 광선을 쏴 보고, 안 맞으면 이유를 캔다
  const ray = new THREE.Raycaster();
  ray.far = 2000;
  ray.set(new THREE.Vector3(46 * METER, 60 * METER, 17 * METER), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObjects(groundMeshes, false);
  const ground = naju.scene.getObjectByName("ground");
  return {
    meshes: groundMeshes.map((m) => m.name + ":" + triangleCount(m.geometry)),
    hitY: hits.length ? +(hits[0].point.y / METER).toFixed(2) : "못 맞힘",
    hitObject: hits.length ? hits[0].object.name : "-",
    boundingSphere: ground?.geometry?.boundingSphere ? "있음" : "없음",
    scale: ground?.scale?.x,
    materialSide: ground?.material?.side,
    matrixWorldNeedsUpdate: ground?.matrixWorldNeedsUpdate,
  };
});
console.log("  " + JSON.stringify(report));
console.log("  로그:", logs.slice(0, 4).join(" | "));
await browser.close();
