// 부감(E → Tab)에서 `,` `.` 로 시점이 실제로 도는가 — 카메라 회전값을 잰다.
import { chromium } from "playwright";
const 브 = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 1100, height: 700 } });
쪽.on("pageerror", (e) => console.log("  pageerror:", (e.message||"").slice(0,140)));
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");           // 시작
await 쪽.waitForTimeout(9000);
await 쪽.keyboard.press("KeyE");           // 편집 모드
await 쪽.waitForTimeout(4000);
const 상태 = () => 쪽.evaluate(() => {
  const c = window.__NAJU?.camera; if (!c) return null;
  return { y: +c.rotation.y.toFixed(3), x: +c.rotation.x.toFixed(3), 높이: +(c.position.y).toFixed(1) };
});
console.log("  편집 진입:", JSON.stringify(await 상태()));
await 쪽.keyboard.press("Tab");            // 부감
await 쪽.waitForTimeout(5000);
const 부감전 = await 상태();
console.log("  부감 진입:", JSON.stringify(부감전));
await 쪽.evaluate(() => { window.__회전디버그 = []; });
await 쪽.keyboard.down("Period");
await 쪽.waitForTimeout(6000);
await 쪽.keyboard.up("Period");
await 쪽.waitForTimeout(1500);
const 부감후 = await 상태();
console.log("  . 을 6초 누른 뒤:", JSON.stringify(부감후));
console.log("  → . 방향 회전:", 부감전 && 부감후 ? (부감후.y - 부감전.y).toFixed(2) + " rad" : "잴 수 없음");
await 쪽.keyboard.down("Comma");
await 쪽.waitForTimeout(6000);
await 쪽.keyboard.up("Comma");
await 쪽.waitForTimeout(1500);
const 반대 = await 상태();
console.log("  → , 방향 회전:", (반대.y - 부감후.y).toFixed(2) + " rad (부호가 반대여야 한다)");
console.log("  기울기 유지:", 반대.x === 부감전.x ? "그대로 " + 반대.x : "★바뀜 " + 반대.x);
console.log("  눌린키가 담기나:", await 쪽.evaluate(() => {
  const r = []; const h = (e) => r.push(e.code);
  window.addEventListener("keydown", h, true);
  return new Promise((res) => setTimeout(() => { window.removeEventListener("keydown", h, true); res(r.join(",") || "(없음)"); }, 100));
}));
await 브.close();
