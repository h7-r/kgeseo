// 부감 휠 회전이 **보고 있는 지점을 축으로** 도는가.
//   제자리 회전이면 화면 한복판의 땅 지점이 크게 휩쓸린다 — 그게 「이동처럼
//   보인다」의 정체였다. 축이 제자리면 그 지점이 거의 안 움직여야 한다.
import { chromium } from "playwright";
const 브 = await chromium.launch({ args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const 쪽 = await 브.newPage({ viewport: { width: 1100, height: 700 } });
쪽.on("pageerror", (e) => console.log("  pageerror:", (e.message||"").slice(0,140)));
await 쪽.goto(process.argv[2], { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT"); await 쪽.waitForTimeout(9000);
await 쪽.keyboard.press("KeyE"); await 쪽.waitForTimeout(4000);
await 쪽.keyboard.press("Tab");  await 쪽.waitForTimeout(5000);
// 화면 한복판이 가리키는 땅 지점 — 축이 제자리면 이게 거의 안 변해야 한다
// 내려다보는 지점을 **식으로** 구한다 — 레이캐스트는 빗나갈 수 있고,
//   축이 제자리인지 보는 데는 기울기·높이·요면 충분하다.
const 한복판 = () => 쪽.evaluate(() => {
  const c = window.__NAJU.camera, 유닛 = 0.3;
  const 요 = c.rotation.y, 기울기 = Math.max(0.15, -c.rotation.x);
  const 높이m = c.position.y * 유닛;           // 기준면 0 으로 봐도 비교에는 충분
  const 앞m = Math.min(400, 높이m / Math.tan(기울기));
  return {
    요: +요.toFixed(3),
    본곳: [
      +(c.position.x * 유닛 - Math.sin(요) * 앞m).toFixed(1),
      +(c.position.z * 유닛 - Math.cos(요) * 앞m).toFixed(1),
    ],
  };
});
const 전 = await 한복판();
console.log("  돌리기 전:", JSON.stringify(전));
await 쪽.evaluate(() => {
  for (let i = 0; i < 30; i++)
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, deltaX: 0, bubbles: true, cancelable: true }));
});
await 쪽.waitForTimeout(5000);
const 후 = await 한복판();
console.log("  돌린 뒤  :", JSON.stringify(후));
if (전.본곳 && 후.본곳) {
  const d = Math.hypot(후.본곳[0]-전.본곳[0], 후.본곳[1]-전.본곳[1]);
  console.log(`  요 변화 ${(후.요-전.요).toFixed(2)} rad · 한복판이 움직인 거리 ${d.toFixed(1)} m`);
  console.log("  →", Math.abs(후.요-전.요) > 0.3 && d < 6 ? "축 회전 (정상)" : d >= 6 ? "★ 화면이 휩쓸린다(제자리 회전)" : "★ 안 돈다");
}
await 브.close();
