// 어느 자리에서 무엇이 무거운지 표로 낸다.
// 쓰는 법  node naju01/tools/diagnose-load.mjs <url>
//
// 헤드리스(SwiftShader) fps 는 의미 없어, 그 시점에 프러스텀으로 잘라 남는 삼각형·드로우콜을 잰다.
// 렌더러 판정을 흉내 내므로 자리별로 견줄 수 있다. 화면을 채우는 픽셀 비용은 안 잡힌다
// (가까이 있는 큰 물건이 범인이면 따로 봐야 한다 — 구렁이가 그랬다).
import { chromium } from "playwright";

const viewpoints = [
  ["Z1 나루터", 18, 38, -0.6],
  ["Z1 마을 안", 14, 36, 1.2],
  ["Z2 자갈밭", 45, 36, -0.8],
  ["절벽 밑", 45, 31, -1.4],
  ["T4 비탈", 28, 27, 2.3],
  ["Z3 대지", 46, 18, 0.2],
  ["Z3 남쪽 마루", 46, 25, -1.5],
  ["T3 스위치백", 60, 10, 1.9],
  ["Z4 능선", 70, 20, -2.2],
  ["구렁이 앞", 23, 41, -1.2],
];

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 160)));
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
await page.waitForTimeout(22000);

const measure = (x, z, heading) =>
  page.evaluate(
    ([X, Z, A]) => {
      const naju = window.__game.naju,
        THREE = naju.THREE;
      naju.teleport?.current?.(X, Z, A);
      const c = naju.camera;
      c.updateMatrixWorld();
      c.updateProjectionMatrix();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse),
      );
      const sphere = new THREE.Sphere();
      let triangles = 0,
        shadowTriangles = 0,
        draws = 0;
      const byName = {};
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
        if (!g.boundingSphere) g.computeBoundingSphere();
        sphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
        if (o.isInstancedMesh && o.boundingSphere) sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
        if (o.frustumCulled !== false && !frustum.intersectsSphere(sphere)) return;
        const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
        triangles += n;
        draws++;
        if (o.castShadow) shadowTriangles += n;
        const k = o.name || "(무명)";
        byName[k] = (byName[k] || 0) + n;
      });
      const top = Object.entries(byName)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}M`);
      return { triangles: Math.round(triangles), shadowTriangles: Math.round(shadowTriangles), draws, top };
    },
    [x, z, heading],
  );

console.log("  시점              그리는 삼각형   그중 그림자   그리기   가장 무거운 것");
const results = [];
for (const [name, x, z, a] of viewpoints) {
  const r = await measure(x, z, a);
  await page.waitForTimeout(600);
  results.push([name, r]);
  console.log(
    `  ${name.padEnd(14)} ${(r.triangles / 1e6).toFixed(2).padStart(9)}M ` +
      `${(r.shadowTriangles / 1e6).toFixed(2).padStart(10)}M ${String(r.draws).padStart(7)}   ${r.top.join(" · ")}`,
  );
}
results.sort((a, b) => b[1].triangles - a[1].triangles);
console.log(`\n  가장 무거운 자리: ${results[0][0]} (${(results[0][1].triangles / 1e6).toFixed(2)}M)`);
console.log(
  `  가장 가벼운 자리: ${results[results.length - 1][0]} (${(results[results.length - 1][1].triangles / 1e6).toFixed(2)}M)`,
);
await browser.close();
