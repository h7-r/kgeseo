// 편집 배치가 새 땅 위에 **제대로 앉았는지** 잰다.
//   재는 법: 배치 좌표(x,z)에서 수직으로 광선을 쏴 `땅` 메시를 맞히고,
//   맞은 높이와 파일에 적힌 y 를 견준다. 「그림과 판정이 다른 면을 본다」를
//   숫자로 잡는 유일한 방법이다.
import { chromium } from "playwright";
const 브 = await chromium.launch();
const 쪽 = await 브.newPage({ viewport: { width: 1280, height: 800 } });
쪽.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 120)));
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(2500);
await 쪽.keyboard.press("KeyT");
await 쪽.waitForTimeout(1500);
await 쪽.evaluate(() => { for (let i = 0; i < 4; i++) document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click()); });
await 쪽.waitForTimeout(800);
if (process.argv[4] === "새지형") {
  await 쪽.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
  for (let i = 0; i < 14; i++) { await 쪽.waitForTimeout(5000);
    if (await 쪽.evaluate(() => !!window.__NAJU?.scene?.getObjectByName("땅")?.geometry?.attributes?.position &&
      (window.__NAJU.scene.getObjectByName("땅").geometry.index?.count ?? 0) / 3 === 128000)) break; }
  await 쪽.waitForTimeout(20000);
}
const 결 = await 쪽.evaluate(async (주소) => {
  const N = window.__NAJU; if (!N) return "창구 없음";
  const THREE = N.THREE, 미터 = 1 / 0.3;
  const j = await (await fetch(주소)).json();
  const 땅 = []; N.scene.traverse((o) => { if (o.isMesh && o.visible && ["땅","길","비탈","절벽면","z.지오"].includes(o.name)) 땅.push(o); });
  const R = new THREE.Raycaster(); R.far = 400;
  const 아래 = new THREE.Vector3(0, -1, 0);
  const 틈 = []; let 못맞힘 = 0;
  for (const 갈래 of ["고침", "더함"])
    for (const 값 of Object.values(j[갈래] ?? {}))
      for (const a of (Array.isArray(값) ? 값 : Object.values(값))) {
        if (!a || !("x" in a && "y" in a && "z" in a)) continue;
        if (a.x < 0.3 || a.x > 79.7 || a.z < 0.3 || a.z > 49.7) continue;  // 코어 밖은 이 땅이 아니다
        R.set(new THREE.Vector3(a.x * 미터, 60 * 미터, a.z * 미터), 아래);
        const h = R.intersectObjects(땅, false);
        if (!h.length) { 못맞힘++; continue; }
        틈.push(a.y - h[0].point.y / 미터);     // + 면 떠 있고 − 면 박혔다
      }
  틈.sort((p, q) => p - q);
  const 백 = (t) => 틈[Math.min(틈.length - 1, Math.floor(틈.length * t))];
  const 절 = 틈.map(Math.abs).sort((p, q) => p - q);
  return { 잰것: 틈.length, 못맞힘,
    중앙: +백(0.5).toFixed(3), 최저: +백(0).toFixed(2), 최고: +백(1).toFixed(2),
    "10cm이내%": Math.round(100 * 절.filter((v) => v <= 0.1).length / 절.length),
    "30cm이내%": Math.round(100 * 절.filter((v) => v <= 0.3).length / 절.length) };
}, process.argv[3]);
console.log("  " + JSON.stringify(결));
await 브.close();
