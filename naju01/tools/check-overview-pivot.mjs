// 부감 휠 회전이 보고 있는 지점을 축으로 도는지 잰다.
// 제자리에서 돌면 화면 한복판의 땅 지점이 크게 휩쓸려 이동처럼 보인다.
// 쓰는 법  node naju01/tools/check-overview-pivot.mjs <url>
import { logPageErrors, openHeadless, startGame } from "./headlessPage.mjs";

const { browser, page } = await openHeadless({ width: 1100, height: 700 });
logPageErrors(page);
await startGame(page, process.argv[2]);
await page.waitForTimeout(9000);
await page.keyboard.press("KeyE");
await page.waitForTimeout(4000);
await page.keyboard.press("Tab");
await page.waitForTimeout(5000);
// 내려다보는 지점을 식으로 구한다 — 레이캐스트는 빗나갈 수 있고, 축 확인엔 기울기·높이·요면 충분하다
const screenCenter = () =>
  page.evaluate(() => {
    const camera = window.__game.naju.camera;
    const UNIT = 0.3;
    const yaw = camera.rotation.y;
    const tilt = Math.max(0.15, -camera.rotation.x);
    const heightM = camera.position.y * UNIT; // 기준면 0 으로 봐도 비교에는 충분
    const aheadM = Math.min(400, heightM / Math.tan(tilt));
    return {
      yaw: +yaw.toFixed(3),
      target: [
        +(camera.position.x * UNIT - Math.sin(yaw) * aheadM).toFixed(1),
        +(camera.position.z * UNIT - Math.cos(yaw) * aheadM).toFixed(1),
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
  const moved = Math.hypot(after.target[0] - before.target[0], after.target[1] - before.target[1]);
  const turned = after.yaw - before.yaw;
  console.log(`  요 변화 ${turned.toFixed(2)} rad · 한복판이 움직인 거리 ${moved.toFixed(1)} m`);
  const verdict =
    Math.abs(turned) > 0.3 && moved < 6 ? "축 회전 (정상)" : moved >= 6 ? "화면이 휩쓸린다(제자리 회전)" : "안 돈다";
  console.log("  →", verdict);
}
await browser.close();
