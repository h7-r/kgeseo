// 쿼리 없이 들어갔을 때 새 지형이 기본으로 올라오는지, 배치가 그 땅에 앉는지 한 번에 잰다.
// 쓰는 법  node naju01/tools/check-default-terrain.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("[새지형]")) logs.push(t);
});
page.on("pageerror", (e) => logs.push("pageerror: " + (e.message || "").slice(0, 140)));
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(5000);
  const triangles = await page.evaluate(() => {
    const m = window.__game?.naju?.scene?.getObjectByName("ground");
    return m ? (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 : 0;
  });
  if (triangles === 128000) break;
}
await page.waitForTimeout(20000);
console.log(
  "  " +
    JSON.stringify(
      await page.evaluate(() => {
        const naju = window.__game?.naju;
        if (!naju) return "창구 없음";
        const THREE = naju.THREE,
          METER = 1 / 0.3;
        const groundMeshes = [];
        naju.scene.traverse((o) => {
          if (!o.isMesh) return;
          let visible = o.visible,
            p = o.parent;
          while (visible && p) {
            visible = p.visible;
            p = p.parent;
          }
          if (visible && ["ground", "path", "slope", "cliffFace", "zone.sides"].includes(o.name)) groundMeshes.push(o);
        });
        const list = groundMeshes.map(
          (m) => m.name + ":" + Math.round((m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3),
        );
        // 땅 한복판에 광선을 쏴 보고, 안 맞으면 이유를 캔다
        const ray = new THREE.Raycaster();
        ray.far = 2000;
        ray.set(new THREE.Vector3(46 * METER, 60 * METER, 17 * METER), new THREE.Vector3(0, -1, 0));
        const hits = ray.intersectObjects(groundMeshes, false);
        const ground = naju.scene.getObjectByName("ground");
        return {
          meshes: list,
          hitY: hits.length ? +(hits[0].point.y / METER).toFixed(2) : "못 맞힘",
          hitObject: hits.length ? hits[0].object.name : "-",
          boundingSphere: ground?.geometry?.boundingSphere ? "있음" : "없음",
          scale: ground?.scale?.x,
          materialSide: ground?.material?.side,
          matrixWorldNeedsUpdate: ground?.matrixWorldNeedsUpdate,
        };
      }),
    ),
);
console.log("  로그:", logs.slice(0, 4).join(" | "));
await browser.close();
