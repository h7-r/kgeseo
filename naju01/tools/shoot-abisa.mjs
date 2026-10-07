// Z1 의 NPC 「아비사」를 앞·옆·전신으로 찍는다.
// 걷기 상태면 지형 이동 훅이 매 프레임 카메라를 덮어써, 구렁이 찍기처럼 편집 부감에 들어가서 찍는다.
// 쓰는 법  node naju01/tools/shoot-abisa.mjs <url> <outDir>
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("console", (m) => {
  const t = m.text();
  if (/구운모형|아비사/.test(t)) console.log("  로그:", t.slice(0, 160));
});
page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 140)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
await page.waitForTimeout(14000);
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
const measured = await page.evaluate(() => {
  const naju = window.__game.naju,
    THREE = naju.THREE;
  // 아비사는 편집기가 집도록 인스턴스 무리(이름 = 한글 무리 이름)다. people.npc 는 모형이 오기 전에만 잠깐 선다.
  let mesh = null;
  naju.scene.traverse((o) => {
    if (!mesh && (o.name === "씬1.아비사" || o.name === "people.npc")) mesh = o;
  });
  if (!mesh) return "NPC 를 못 찾음";
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  box.getCenter(center);
  window.__npc = [center.x, center.y, center.z];
  window.__npcGround = box.min.y;
  const g = mesh.geometry;
  if (!window.__npc) return "상자를 못 쟀다";
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
  };
});
console.log("  " + JSON.stringify(measured));
const shoot = async (name, distance, bearing, lift) => {
  await page.evaluate(
    ([d, a, up]) => {
      const naju = window.__game.naju,
        THREE = naju.THREE;
      const h = new THREE.Vector3(...window.__npc);
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
await shoot("전신_앞", 7.0, Math.PI * 0.15, 1.0);
await shoot("전신_옆", 7.0, Math.PI * 0.65, 1.0);
await shoot("얼굴", 2.2, Math.PI * 0.15, 1.6);
await shoot("발밑", 4.0, Math.PI * 0.15, -1.4);
await browser.close();
