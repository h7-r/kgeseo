// 부감 휠 회전이 보고 있는 지점을 축으로 도는지 잰다.
// 제자리 회전이면 화면 한복판의 땅 지점이 크게 휩쓸린다 — 그게 「이동처럼 보인다」의 정체였다.
// 쓰는 법  node naju01/tools/check-overview-pivot.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 140)));
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT");
await page.waitForTimeout(9000);
await page.keyboard.press("KeyE");
await page.waitForTimeout(4000);
await page.keyboard.press("Tab");
await page.waitForTimeout(5000);
// 내려다보는 지점을 식으로 구한다 — 레이캐스트는 빗나갈 수 있고, 축 확인엔 기울기·높이·요면 충분하다
const screenCenter = () =>
  page.evaluate(() => {
    const c = window.__game.naju.camera,
      UNIT = 0.3;
    const yaw = c.rotation.y,
      tilt = Math.max(0.15, -c.rotation.x);
    const heightM = c.position.y * UNIT; // 기준면 0 으로 봐도 비교에는 충분
    const aheadM = Math.min(400, heightM / Math.tan(tilt));
    return {
      yaw: +yaw.toFixed(3),
      target: [
        +(c.position.x * UNIT - Math.sin(yaw) * aheadM).toFixed(1),
        +(c.position.z * UNIT - Math.cos(yaw) * aheadM).toFixed(1),
      ],
    };
  });
const before = await screenCenter();
console.log("  돌리기 전:", JSON.stringify(before));
await page.evaluate(() => {
  for (let i = 0; i < 30; i++)
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, deltaX: 0, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(5000);
const after = await screenCenter();
console.log("  돌린 뒤  :", JSON.stringify(after));
if (before.target && after.target) {
  const d = Math.hypot(after.target[0] - before.target[0], after.target[1] - before.target[1]);
  console.log(`  요 변화 ${(after.yaw - before.yaw).toFixed(2)} rad · 한복판이 움직인 거리 ${d.toFixed(1)} m`);
  console.log(
    "  →",
    Math.abs(after.yaw - before.yaw) > 0.3 && d < 6
      ? "축 회전 (정상)"
      : d >= 6
        ? "★ 화면이 휩쓸린다(제자리 회전)"
        : "★ 안 돈다",
  );
}
await browser.close();
