// 아무 쿼리 없이 들어갔을 때 **새 지형이 기본으로 올라오는지**, 그리고
// 배치가 그 땅에 앉는지 한 번에 잰다.
import { chromium } from "playwright";
const 브 = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 1280, height: 760 } });
const 로그 = [];
쪽.on("console", (m) => { const t = m.text(); if (t.startsWith("[새지형]")) 로그.push(t); });
쪽.on("pageerror", (e) => 로그.push("pageerror: " + (e.message || "").slice(0, 140)));
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
for (let i = 0; i < 20; i++) {
  await 쪽.waitForTimeout(5000);
  const 됨 = await 쪽.evaluate(() => {
    const m = window.__NAJU?.scene?.getObjectByName("땅");
    return m ? (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 : 0;
  });
  if (됨 === 128000) break;
}
await 쪽.waitForTimeout(20000);
console.log("  " + JSON.stringify(await 쪽.evaluate(() => {
  const N = window.__NAJU; if (!N) return "창구 없음";
  const THREE = N.THREE, 미터 = 1 / 0.3;
  const 땅 = []; N.scene.traverse((o) => {
    if (!o.isMesh) return;
    let 보임 = o.visible, p = o.parent; while (보임 && p) { 보임 = p.visible; p = p.parent; }
    if (보임 && ["땅","길","비탈","절벽면","z.지오"].includes(o.name)) 땅.push(o);
  });
  const 목 = 땅.map((m) => m.name + ":" + Math.round((m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3));
  // 땅 한복판에 광선을 쏴 본다 — 안 맞으면 그 이유를 캔다
  const R = new THREE.Raycaster(); R.far = 2000;
  R.set(new THREE.Vector3(46 * 미터, 60 * 미터, 17 * 미터), new THREE.Vector3(0, -1, 0));
  const h = R.intersectObjects(땅, false);
  const 땅메시 = N.scene.getObjectByName("땅");
  return { 메시: 목, 맞음: h.length ? +(h[0].point.y / 미터).toFixed(2) : "못 맞힘",
    맞은것: h.length ? h[0].object.name : "-",
    경계구: 땅메시?.geometry?.boundingSphere ? "있음" : "없음",
    스케일: 땅메시?.scale?.x, 재질면: 땅메시?.material?.side,
    행렬갱신: 땅메시?.matrixWorldNeedsUpdate };
})));
console.log("  로그:", 로그.slice(0, 4).join(" | "));
await 브.close();
