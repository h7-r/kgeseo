// 손잡이를 켰을 때 **어떤 메시가 사라지고 무엇이 생기는지**를 이름별로 센다.
//   총 삼각형은 초목 인스턴스가 1,370 만이라 바닥 교체가 묻힌다 — 이름별로 봐야 한다.
import { chromium } from "playwright";
const 브 = await chromium.launch();
const 쪽 = await 브.newPage({ viewport: { width: 1400, height: 900 } });
const 로그 = [];
쪽.on("console", (m) => { const t = m.text(); if (t.startsWith("[새지형]")) 로그.push(t); });
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(2500);
await 쪽.keyboard.press("KeyT");            // 게임 시작 — 씬이 살아 있어야 계기판이 돈다
await 쪽.waitForTimeout(2000);

// ※ 이 저장소엔 검사용 창구가 이미 있다 — `window.__NAJU.scene`.
//   r3f 내부를 뒤질 필요가 없다.
const 세기 = () => 쪽.evaluate(() => {
  const s = window.__NAJU?.scene; if (!s) return "씬 못 찾음";
  const 볼것 = ["땅", "길", "비탈", "절벽면", "연결로", "z.지오"];
  const 셈 = {};
  s.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let 보임 = o.visible, p = o.parent;
    while (보임 && p) { 보임 = p.visible; p = p.parent; }
    if (!보임 || !볼것.includes(o.name)) return;
    const g = o.geometry;
    const n = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
    셈[o.name] = (셈[o.name] || 0) + n;
  });
  // 판정도 같이 잰다 — 그림만 바뀌고 발밑이 안 바뀌면 예전 병이 도진다
  const 지 = window.__NAJU?.지형;
  const 잼 = 지 ? [[40,47],[36,29],[22,31],[46,17],[61,13]].map(([x,z]) =>
        x + "," + z + "=" + 지.지면(x, z).y.toFixed(2)).join(" ") : "-";
  return { ...셈, 발밑: 잼 };
});
console.log("  [옛 지형]", JSON.stringify(await 세기()));
await 쪽.evaluate(() => {
  for (let i = 0; i < 4; i++) document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click());
});
await 쪽.waitForTimeout(1200);
await 쪽.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
for (let i = 0; i < 12; i++) {                 // GLB 가 올 때까지 기다린다
  await 쪽.waitForTimeout(5000);
  if (로그.some((l) => l.includes("삼각형") || l.includes("실패"))) break;
}
// ※ 헤드리스는 SwiftShader라 **한 프레임이 3~4 초**다. 로그가 찍힌 뒤에도
//   리액트 이펙트가 커밋될 때까지 몇 프레임이 더 필요하다. 3 초만 기다렸다가
//   「판정이 안 바뀌었다」고 잘못 읽은 적이 있다.
await 쪽.waitForTimeout(20000);
console.log("  [새 지형]", JSON.stringify(await 세기()));
console.log("  진단:", await 쪽.evaluate(() => {
  const 지 = window.__NAJU?.지형;
  return JSON.stringify({
    높이표설정있나: typeof 지?.높이표설정,
    설정값: window.__NAJU?.설정?.새지형,
    지형객체수: window.__지형본적 ? 1 : 1,
  });
}));
console.log("  손으로 끼워보기:", await 쪽.evaluate(async () => {
  const 지 = window.__NAJU?.지형;
  if (typeof 지?.높이표설정 !== "function") return "높이표설정이 없다";
  const 앞 = 지.지면(40, 47).y;
  const m = await import("/src/지형표.js");
  const 표 = await m.높이표불러오기();
  if (!표) return "표를 못 읽었다";
  지.높이표설정(표);
  const 뒤 = 지.지면(40, 47).y;
  return `앞 ${앞.toFixed(2)} → 뒤 ${뒤.toFixed(2)} (표 ${표.높이(40,47).toFixed(2)})`;
}));
console.log("  로그:", 로그.join(" | "));
await 브.close();
