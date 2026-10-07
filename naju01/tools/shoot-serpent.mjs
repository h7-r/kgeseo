// 구렁이 머리를 바로 앞에서 찍는다 — 눈·혀 칠이 어디 앉았는지 봐야 고친다.
// 쓰는 법  node naju01/tools/shoot-serpent.mjs <url> <outDir>
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 140)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
await page.waitForTimeout(16000);
// 편집 → 부감으로 들어가야 걷기가 멈춘다. 아니면 지형 이동 훅이 매 프레임 카메라를 덮어쓴다.
await page.keyboard.press("KeyE");
await page.waitForTimeout(5000);
await page.keyboard.press("Tab");
await page.waitForTimeout(6000);
await page.evaluate(() => {
  document.querySelectorAll("div").forEach((d) => {
    if (d.children.length === 0 && /WASD|Leva 아래쪽/.test(d.textContent)) {
      let p = d;
      for (let i = 0; i < 3 && p.parentElement; i++) p = p.parentElement;
      p.style.display = "none";
    }
  });
});
const found = await page.evaluate(() => {
  const naju = window.__game.naju,
    THREE = naju.THREE;
  let mesh = null;
  // 인스턴스 무리 이름은 편집 파일의 무리 이름(한글 저장값) 그대로다
  naju.scene.traverse((o) => {
    if (o.isInstancedMesh && o.name === "씬1.구렁이") mesh = o;
  });
  if (!mesh) return "구렁이를 못 찾음";
  // 「가장 높은 꼭짓점」은 또아리 고리가 더 높으면 엉뚱한 데를 잡아, 거의 검게 칠한 동공을 색으로 찾는다
  const geo = mesh.geometry,
    pos = geo.attributes.position,
    col = geo.attributes.color;
  let n = 0,
    sum = [0, 0, 0];
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
  const M = new THREE.Matrix4();
  mesh.getMatrixAt(0, M);
  const eye = new THREE.Vector3(sum[0] / n, sum[1] / n, sum[2] / n).applyMatrix4(M);
  window.__head = [eye.x, eye.y, eye.z];
  return { pupilVertices: n, eye: [eye.x, eye.y, eye.z].map((v) => +v.toFixed(2)) };
});
console.log("  " + JSON.stringify(found));
const shoot = async (name, distance, bearing, lift) => {
  await page.evaluate(
    ([d, a, up]) => {
      const naju = window.__game.naju,
        THREE = naju.THREE;
      const h = new THREE.Vector3(...window.__head);
      const c = naju.camera;
      c.position.set(h.x + Math.sin(a) * d, h.y + up, h.z + Math.cos(a) * d);
      c.lookAt(h);
    },
    [distance, bearing, lift],
  );
  await page.waitForTimeout(7000);
  const dataUrl = await page.evaluate(() => {
    const naju = window.__game.naju;
    naju.gl.render(naju.scene, naju.camera);
    return naju.gl.domElement.toDataURL("image/png");
  });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("  찍음", name);
};
// 거리는 유닛(1 유닛 = 0.3 m). 머리가 26 cm 라 바짝 붙여야 5 cm 눈의 칠이 보인다.
await shoot("머리_아주가까이", 0.75, 1.5, 0.06);
await shoot("머리_옆", 1.3, 1.6, 0.12);
await shoot("머리_반대옆", 1.3, -1.6, 0.12);
await shoot("몸통", 5.0, 1.0, 1.6);
await browser.close();
