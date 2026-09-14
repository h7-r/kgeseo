// 구렁이 머리를 **바로 앞에서** 찍는다. 눈·혀 칠이 어디에 앉았는지 봐야
// 고칠 수 있다. 씬에서 머리 꼭짓점을 찾아 카메라를 그 앞에 놓는다.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const [주소, 폴더] = process.argv.slice(2);
mkdirSync(폴더, { recursive: true });
const 브 = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 1000, height: 700 } });
쪽.on("pageerror", (e) => console.log("  pageerror:", (e.message||"").slice(0,140)));
await 쪽.goto(주소, { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
await 쪽.waitForTimeout(16000);
// ★ 편집 → 부감으로 들어가야 **걷기가 멈춘다.** 안 그러면 `use지형이동` 이
//   매 프레임 카메라를 제 값으로 덮어써서, 아무리 놓아도 물가를 보고 있다.
await 쪽.keyboard.press("KeyE");
await 쪽.waitForTimeout(5000);
await 쪽.keyboard.press("Tab");
await 쪽.waitForTimeout(6000);
await 쪽.evaluate(() => {
  document.querySelectorAll("div").forEach((d) => {
    if (d.children.length === 0 && /WASD|Leva 아래쪽/.test(d.textContent)) {
      let p = d; for (let i = 0; i < 3 && p.parentElement; i++) p = p.parentElement;
      p.style.display = "none";
    }
  });
});
const 컷 = await 쪽.evaluate(() => {
  const N = window.__NAJU, THREE = N.THREE;
  let m = null;
  N.scene.traverse((o) => { if (o.isInstancedMesh && o.name === "씬1.구렁이") m = o; });
  if (!m) return "구렁이를 못 찾음";
  // ★ 겨냥할 곳은 **칠해진 동공**이다. 「가장 높은 꼭짓점」은 또아리 고리가
  //   더 높을 때 엉뚱한 데를 잡는다(실제로 머리가 화면 밖으로 나갔다).
  //   동공은 거의 검게 칠해 두었으니 색으로 바로 찾을 수 있다.
  const g = m.geometry, p = g.attributes.position, c = g.attributes.color;
  let n = 0, s = [0, 0, 0];
  if (c) for (let i = 0; i < p.count; i++) {
    if (c.getX(i) < 0.1 && c.getY(i) < 0.1 && c.getZ(i) < 0.1) {
      n++; s[0] += p.getX(i); s[1] += p.getY(i); s[2] += p.getZ(i);
    }
  }
  // ★ 색이 **입혀진** 모형에는 「거의 검은 동공」이 없다(코드가 칠하던
  //   모형에만 있었다). 못 찾으면 가장 높은 꼭짓점 = 쳐든 머리로 간다.
  if (!n) {
    let 최고 = -Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 최고) { 최고 = p.getY(i); s = [p.getX(i), p.getY(i), p.getZ(i)]; }
    }
    n = 1;
  }
  const M = new THREE.Matrix4(); m.getMatrixAt(0, M);
  const 눈 = new THREE.Vector3(s[0] / n, s[1] / n, s[2] / n).applyMatrix4(M);
  window.__머리 = [눈.x, 눈.y, 눈.z];
  return { 동공수: n, 눈: [눈.x, 눈.y, 눈.z].map((v) => +v.toFixed(2)) };
});
console.log("  " + JSON.stringify(컷));
const 찍기 = async (이름, 거리, 방위, 올림) => {
  await 쪽.evaluate(([d, a, up]) => {
    const N = window.__NAJU, THREE = N.THREE;
    const h = new THREE.Vector3(...window.__머리);
    const c = N.camera;
    c.position.set(h.x + Math.sin(a) * d, h.y + up, h.z + Math.cos(a) * d);
    c.lookAt(h);
  }, [거리, 방위, 올림]);
  await 쪽.waitForTimeout(7000);
  const 자료 = await 쪽.evaluate(() => {
    const N = window.__NAJU; N.gl.render(N.scene, N.camera);
    return N.gl.domElement.toDataURL("image/png");
  });
  writeFileSync(`${폴더}/${이름}.png`, Buffer.from(자료.split(",")[1], "base64"));
  console.log("  찍음", 이름);
};
// ※ 거리는 **유닛**이다(1 유닛 = 0.3 m). 머리가 26 cm 라 2.2 유닛(66 cm)
//   에서는 눈(5 cm)이 몇 픽셀이다. 바짝 붙여야 칠을 볼 수 있다.
await 찍기("머리_아주가까이", 0.75, 1.5, 0.06);
await 찍기("머리_옆", 1.3, 1.6, 0.12);
await 찍기("머리_반대옆", 1.3, -1.6, 0.12);
await 찍기("몸통", 5.0, 1.0, 1.6);
await 브.close();
