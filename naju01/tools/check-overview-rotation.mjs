// 부감(E → Tab)에서 `,` `.` 로 시점이 실제로 도는지 카메라 회전값을 잰다.
// 쓰는 법  node naju01/tools/check-overview-rotation.mjs <url>
import { logPageErrors, openHeadless, startGame } from "./headlessPage.mjs";

const { browser, page } = await openHeadless({ width: 1100, height: 700 });
logPageErrors(page);
await startGame(page, process.argv[2]);
await page.waitForTimeout(9000);
await page.keyboard.press("KeyE"); // 편집 모드
await page.waitForTimeout(4000);
const cameraState = () =>
  page.evaluate(() => {
    const camera = window.__game?.naju?.camera;
    if (!camera) return null;
    return {
      y: +camera.rotation.y.toFixed(3),
      x: +camera.rotation.x.toFixed(3),
      height: +camera.position.y.toFixed(1),
    };
  });
console.log("  편집 진입:", JSON.stringify(await cameraState()));
await page.keyboard.press("Tab"); // 부감
await page.waitForTimeout(5000);
const before = await cameraState();
console.log("  부감 진입:", JSON.stringify(before));

/** 키를 6 초 누르고 놓은 뒤 카메라 상태를 읽는다 */
async function holdKey(code) {
  await page.keyboard.down(code);
  await page.waitForTimeout(6000);
  await page.keyboard.up(code);
  await page.waitForTimeout(1500);
  return cameraState();
}
const after = await holdKey("Period");
console.log("  . 을 6초 누른 뒤:", JSON.stringify(after));
console.log("  → . 방향 회전:", before && after ? (after.y - before.y).toFixed(2) + " rad" : "잴 수 없음");
const reverse = await holdKey("Comma");
console.log("  → , 방향 회전:", (reverse.y - after.y).toFixed(2) + " rad (부호가 반대여야 한다)");
console.log("  기울기 유지:", reverse.x === before.x ? "그대로 " + reverse.x : "바뀜 " + reverse.x);
console.log(
  "  눌린키가 담기나:",
  await page.evaluate(() => {
    const codes = [];
    const onKey = (e) => codes.push(e.code);
    window.addEventListener("keydown", onKey, true);
    return new Promise((resolve) =>
      setTimeout(() => {
        window.removeEventListener("keydown", onKey, true);
        resolve(codes.join(",") || "(없음)");
      }, 100),
    );
  }),
);
await browser.close();
