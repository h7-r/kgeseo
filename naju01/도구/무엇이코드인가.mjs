// 맵에 있는 것을 **통짜 메시**와 **인스턴스 무리**로 갈라 센다.
//   통짜 메시 = 코드가 그 자리에서 지오메트리를 만든 것(편집 불가)
//   인스턴스 무리 = 표본을 심은 것(편집 가능). 표본이 구운 모형인지는 코드가 정한다.
import { chromium } from "playwright";
const 브 = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 900, height: 600 } });
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
await 쪽.waitForTimeout(16000);
const r = await 쪽.evaluate(() => {
  const N = window.__NAJU; if (!N) return null;
  const 통 = {}, 무 = {};
  N.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let b = o.visible, p = o.parent; while (b && p) { b = p.visible; p = p.parent; }
    if (!b) return;
    const g = o.geometry;
    const 면 = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
    const 이름 = o.name || "(무명)";
    const 통계 = o.isInstancedMesh ? 무 : 통;
    통계[이름] = 통계[이름] || { 개: 0, 면: 0 };
    통계[이름].개 += o.isInstancedMesh ? o.count : 1;
    통계[이름].면 = Math.max(통계[이름].면, 면);
  });
  const 줄 = (o) => Object.entries(o).sort((a, b) => b[1].개 * b[1].면 - a[1].개 * a[1].면)
    .map(([k, v]) => `${k}|${v.개}|${v.면}`);
  return { 통: 줄(통), 무: 줄(무) };
});
if (!r) { console.log("창구 없음"); } else {
  console.log("== 통짜 메시(코드가 그 자리에서 만든 것 · 편집 불가) ==");
  for (const s of r.통) { const [n, c, f] = s.split("|"); console.log(`  ${n.padEnd(20)} ${c.padStart(4)}개 × ${Number(f).toLocaleString().padStart(9)}면`); }
  console.log("== 인스턴스 무리(표본을 심은 것 · 편집 가능) ==");
  for (const s of r.무) { const [n, c, f] = s.split("|"); console.log(`  ${n.padEnd(20)} ${c.padStart(4)}개 × ${Number(f).toLocaleString().padStart(9)}면`); }
}
await 브.close();
