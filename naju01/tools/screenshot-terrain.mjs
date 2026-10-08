// 같은 시점에서 새 지형 손잡이를 끈 땅 / 켠 땅을 각각 찍어 나란히 본다.
// 쓰는 법  node naju01/tools/screenshot-terrain.mjs <url> <outDir> [new-terrain]
import { mkdirSync } from "node:fs";

import {
  captureCanvas,
  expandLevaFolders,
  hideHelpText,
  logPageErrors,
  openHeadless,
  startGame,
  toggleBakedTerrain,
  waitForBakedGround,
} from "./headlessPage.mjs";

const [url, outDir, mode] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const { browser, page } = await openHeadless({ width: 1280, height: 760 }, [
  "--disable-gpu-sandbox",
  "--ignore-gpu-blocklist",
]);
logPageErrors(page);
await startGame(page, url);
await page.waitForTimeout(2500);
await expandLevaFolders(page);
if (mode === "new-terrain") {
  await toggleBakedTerrain(page);
  await waitForBakedGround(page, 16);
  await page.waitForTimeout(20000); // 이펙트 커밋 + 몇 프레임
}
// 계기판(H 토글)·Leva·안내문을 숨겨 화면만 남긴다
await page.keyboard.press("KeyH");
await page.evaluate(() => {
  document.querySelectorAll('[class*="leva"]').forEach((e) => (e.style.display = "none"));
});
await hideHelpText(page, "WASD 이동|Leva 아래쪽");
const viewpoints = [
  ["구렁이_가까이", 21.2, 37.6, 2.2],
  ["구렁이_옆에서", 25.5, 40.5, -1.9],
  ["구렁이_멀리", 18, 35, 2.4],
];
for (const [name, x, z, heading] of viewpoints) {
  await page.evaluate(([px, pz, a]) => window.__game?.naju?.teleport?.current?.(px, pz, a), [x, z, heading]);
  await page.waitForTimeout(9000); // 프레임 두세 장
  if (await captureCanvas(page, `${outDir}/${name}.png`)) console.log("  찍음", name);
  else console.log("  캔버스를 못 읽었다", name);
}
await browser.close();
