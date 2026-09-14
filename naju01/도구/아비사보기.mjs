// Z1 의 NPC 「아비사」를 앞·옆·전신으로 찍는다.
//   구렁이보기와 같은 이유로 **편집 부감**에 들어가서 찍는다. 걷기 상태면
//   `use지형이동` 이 매 프레임 카메라를 덮어써서 어디를 놓든 소용이 없다.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const [주소, 폴더] = process.argv.slice(2);
mkdirSync(폴더, { recursive: true });
const 브 = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 900, height: 900 } });
쪽.on("console", (m) => { const t = m.text(); if (/구운모형|아비사/.test(t)) console.log("  로그:", t.slice(0,160)); });
쪽.on("pageerror", (e) => console.log("  pageerror:", (e.message||"").slice(0,140)));
await 쪽.goto(주소, { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
await 쪽.waitForTimeout(14000);
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
const 잼 = await 쪽.evaluate(() => {
  const N = window.__NAJU, THREE = N.THREE;
  // ★ 아비사는 이제 **인스턴스 무리** `씬1.아비사` 다(편집기가 집어야 해서).
  //   옛 이름 `사람조형.NPC` 는 모형이 아직 안 왔을 때만 잠깐 선다.
  let m = null;
  N.scene.traverse((o) => { if (!m && (o.name === "씬1.아비사" || o.name === "사람조형.NPC")) m = o; });
  if (!m) return "NPC 를 못 찾음";
  m.updateWorldMatrix(true, false);
  const 상자 = new THREE.Box3().setFromObject(m);
  const 가 = new THREE.Vector3(); 상자.getCenter(가);
  window.__NPC = [가.x, 가.y, 가.z];
  window.__NPC바닥 = 상자.min.y;
  const g = m.geometry;
  if (!window.__NPC) return "상자를 못 쟀다";
  return {
    이름: m.name,
    삼각형: (g.index ? g.index.count : g.attributes.position.count) / 3,
    정점색: !!g.attributes.color, UV: !!g.attributes.uv,
    재질: m.material?.type, 맵: !!m.material?.map,
    상자아래: +상자.min.y.toFixed(2), 상자위: +상자.max.y.toFixed(2),
    높이m: +((상자.max.y - 상자.min.y) * 0.3).toFixed(2),
  };
});
console.log("  " + JSON.stringify(잼));
const 찍기 = async (이름, 거리, 방위, 올림) => {
  await 쪽.evaluate(([d, a, up]) => {
    const N = window.__NAJU, THREE = N.THREE;
    const h = new THREE.Vector3(...window.__NPC);
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
await 찍기("전신_앞", 7.0, Math.PI * 0.15, 1.0);
await 찍기("전신_옆", 7.0, Math.PI * 0.65, 1.0);
await 찍기("얼굴", 2.2, Math.PI * 0.15, 1.6);
await 찍기("발밑", 4.0, Math.PI * 0.15, -1.4);
await 브.close();
