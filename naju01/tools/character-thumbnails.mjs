// 카탈로그 카드 썸네일 굽기 — gait.html 의 실제 모델을 찍어 잘라 낸다.
//   node naju01/tools/character-thumbnails.mjs   (개발 서버 5174 필요)
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

const browser = await chromium.launch({ channel: "chrome", headless: false });
for (const [name, query, part, gender] of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await page.goto(`http://localhost:5174/gait.html?toon=1&outline=1&${query}`, { waitUntil: "networkidle" });
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
await browser.close();
