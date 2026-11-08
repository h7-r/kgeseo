// 카탈로그 카드 썸네일 굽기 — gait.html 의 실제 모델을 찍어 잘라 낸다.
//   node naju01/tools/character-thumbnails.mjs [이름 …]   (개발 서버 5174 필요, 다른 포트면 PORT=5274)
//   이름을 주면 그 카드만 굽는다(예: hair.buzz.m hair.buzz.f). 안 주면 전부.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const outDir = fileURLToPath(new URL("../../public/thumbs/character-creation/", import.meta.url));
mkdirSync(outDir, { recursive: true });

// gait.html 정면: 남자는 화면 가운데(x≈700), 여자는 오른쪽(x≈1060) 근처
const MALE_CROP = { x: 560, w: 300 };
const FEMALE_CROP = { x: 900, w: 300 };
const PART_CROPS = {
  head: { y: 90, h: 190 },
  torso: { y: 230, h: 230 },
  hips: { y: 360, h: 230 },
  feet: { y: 560, h: 170 },
};
// [파일 이름, 쿼리, 부위, 성별]
const SHOTS = [
  ["hair.none", "hair=-1", "head", "m"],
  ["hair.m.crop", "hair=0", "head", "m"],
  ["hair.m.long", "hair=1", "head", "m"],
  ["hair.f.bob", "hair=0", "head", "f"],
  ["hair.f.long", "hair=1", "head", "f"],
  ["top.none.m", "top=-1&bottom=-1&shoes=-1", "torso", "m"],
  ["top.tee.white.m", "top=0&bottom=-1&shoes=-1", "torso", "m"],
  ["top.none.f", "top=-1&bottom=-1&shoes=-1", "torso", "f"],
  ["top.tee.white.f", "top=0&bottom=-1&shoes=-1", "torso", "f"],
  ["bottom.none.m", "top=-1&bottom=-1&shoes=-1", "hips", "m"],
  ["bottom.shorts.black.m", "top=-1&bottom=0&shoes=-1", "hips", "m"],
  ["bottom.none.f", "top=-1&bottom=-1&shoes=-1", "hips", "f"],
  ["bottom.shorts.black.f", "top=-1&bottom=0&shoes=-1", "hips", "f"],
  ["shoes.none.m", "shoes=-1", "feet", "m"],
  ["shoes.sneaker.white.m", "shoes=0", "feet", "m"],
  ["shoes.none.f", "shoes=-1", "feet", "f"],
  ["shoes.sneaker.white.f", "shoes=0", "feet", "f"],
];

// 카메라를 직접 놓아 찍는 카드. 위 SHOTS 는 gait 화면의 기본 카메라를 고정 자리에서 잘라 내는데, 그 뒤 기본 외형
// (성별·머리 크기 0.8 등)이 바뀌어 그대로 찍으면 기존 머리 카드와 틀이 안 맞는다. 여기서는 직교 카메라 가운데를
// (아바타 x, 높이 cy)에 두고 세로 h(m)만큼 보이게 한 뒤 1000×1000 화면 가운데 근처 300×190 을 자른다 —
// 기존 머리 카드처럼 머리 폭 약 120 px, 눈높이가 위에서 약 150 px 에 온다. 대기 동작 0초에 멈춰 찍는다.
// 피부·머리색은 흰색(원본) — 반삭은 머리 메시가 없어 몸의 두피를 칠하므로 원본이면 기본 머리 텍스처 평균색으로 보인다.
// [파일 이름, 쿼리, 아바타 x(가운데 남 0 · 오른쪽 여 1.1), cy(m), h(m)]
const FRAMED_SHOTS = [
  ["hair.buzz.m", "hair=2&skinColor=%23ffffff&hairColor=%23ffffff", 0, 1.195, 2.1],
  ["hair.buzz.f", "hair=2&skinColor=%23ffffff&hairColor=%23ffffff", 1.1, 1.195, 2.1],
];
const FRAMED_CLIP = { x: 350, y: 350, width: 300, height: 190 };

const port = process.env.PORT ?? "5174";
const only = new Set(process.argv.slice(2));
const browser = await chromium.launch({ channel: "chrome", headless: false });
for (const [name, query, part, gender] of SHOTS) {
  if (only.size && !only.has(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto(`http://localhost:${port}/gait.html?toon=1&outline=1&${query}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(7000);
  await page.getByText("대기", { exact: true }).click();
  await page.getByText("정면", { exact: true }).click();
  await page.waitForTimeout(2200);
  const horizontal = gender === "m" ? MALE_CROP : FEMALE_CROP;
  const vertical = PART_CROPS[part];
  await page.screenshot({
    path: `${outDir}/${name}.png`,
    clip: { x: horizontal.x, y: vertical.y, width: horizontal.w, height: vertical.h },
  });
  console.log("구움", name);
  await page.close();
}
for (const [name, query, x, cy, h] of FRAMED_SHOTS) {
  if (only.size && !only.has(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 });
  // 가운데 = 남자가 되도록 성별을 준다(기본 외형이 여자다)
  await page.goto(`http://localhost:${port}/gait.html?toon=1&outline=1&gender=masculine&${query}`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => window.__game?.gait, null, { timeout: 90000 });
  await page.waitForTimeout(7000);
  await page.getByText("대기", { exact: true }).click();
  await page.getByText("재생", { exact: true }).click();
  await page.getByText("정면", { exact: true }).click();
  // 구간 0초 — 대기 동작의 같은 자세로 찍는다
  await page.evaluate(() => {
    const input = document.querySelector('input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "0");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const panel = document.querySelector("#root > div");
    if (panel) panel.style.display = "none";
  });
  await page.evaluate(
    ([x, cy, h]) => {
      const camera = window.__game.gait.three.camera;
      camera.left = -h / 2;
      camera.right = h / 2;
      camera.top = h / 2;
      camera.bottom = -h / 2;
      camera.position.set(x, cy, 6);
      camera.lookAt(x, cy, 0);
      camera.updateProjectionMatrix();
    },
    [x, cy, h],
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${name}.png`, clip: FRAMED_CLIP });
  console.log("구움", name);
  await page.close();
}
await browser.close();
