// 부감(E → Tab)에서 `,` `.` 로 시점이 실제로 도는지 카메라 회전값을 잰다.
// 쓰는 법  node naju01/tools/check-overview-rotation.mjs <url>
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 140)));
await page.goto(process.argv[2], { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.keyboard.press("KeyT"); // 시작
await page.waitForTimeout(9000);
await page.keyboard.press("KeyE"); // 편집 모드
await page.waitForTimeout(4000);
const cameraState = () =>
  page.evaluate(() => {
    const c = window.__game?.naju?.camera;
    if (!c) return null;
    return { y: +c.rotation.y.toFixed(3), x: +c.rotation.x.toFixed(3), height: +c.position.y.toFixed(1) };
  });
console.log("  편집 진입:", JSON.stringify(await cameraState()));
await page.keyboard.press("Tab"); // 부감
await page.waitForTimeout(5000);
const before = await cameraState();
console.log("  부감 진입:", JSON.stringify(before));
await page.evaluate(() => {
  window.__rotationDebug = [];
});
await page.keyboard.down("Period");
await page.waitForTimeout(6000);
await page.keyboard.up("Period");
await page.waitForTimeout(1500);
const after = await cameraState();
console.log("  . 을 6초 누른 뒤:", JSON.stringify(after));
console.log("  → . 방향 회전:", before && after ? (after.y - before.y).toFixed(2) + " rad" : "잴 수 없음");
await page.keyboard.down("Comma");
await page.waitForTimeout(6000);
await page.keyboard.up("Comma");
await page.waitForTimeout(1500);
const reverse = await cameraState();
console.log("  → , 방향 회전:", (reverse.y - after.y).toFixed(2) + " rad (부호가 반대여야 한다)");
console.log("  기울기 유지:", reverse.x === before.x ? "그대로 " + reverse.x : "★바뀜 " + reverse.x);
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
