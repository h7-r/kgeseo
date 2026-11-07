// 팀 캐릭터 전용 옷 썸네일 굽기(검토 22회차) — naju01/tools/character-thumbnails.mjs 와 같은 gait.html 화면 · 자르기라
// 카드가 기존 썸네일과 같은 모양이 된다. 가운데 몸체는 지금 기본이 여성이라 남자 칸은 gender=masculine 을 넘긴다.
//   npx vite naju01 &   (5174)  →  node tools/team-npc-thumbnails.mjs
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
const OUT = fileURLToPath(new URL("../public/thumbs/character-creation/", import.meta.url));
const MALE_CROP = { x: 560, w: 300 };
const FEMALE_CROP = { x: 900, w: 300 };
const PART_CROPS = { head: { y: 90, h: 190 }, torso: { y: 230, h: 230 }, hips: { y: 360, h: 230 } };
const SHOTS = [
  ["hair.cap.none", "hair=9", "head", "m"],
  ["hair.m.crop.cap", "hair=10", "head", "m"],
  ["hair.m.long.cap", "hair=11", "head", "m"],
  ["hair.f.bob.cap", "hair=10", "head", "f"],
  ["hair.f.long.cap", "hair=11", "head", "f"],
  ["top.tee.marine.m", "top=1&bottom=-1&shoes=-1", "torso", "m"],
  ["top.tee.marine.f", "top=1&bottom=-1&shoes=-1", "torso", "f"],
  ["bottom.jeans.skinny.m", "top=-1&bottom=1&shoes=-1", "hips", "m"],
  ["bottom.jeans.skinny.f", "top=-1&bottom=1&shoes=-1", "hips", "f"],
  ["bottom.pants.baggy.m", "top=-1&bottom=2&shoes=-1", "hips", "m"],
  ["bottom.pants.baggy.f", "top=-1&bottom=2&shoes=-1", "hips", "f"],
];
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
for (const [name, query, part, gender] of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `http://localhost:5174/gait.html?toon=1&outline=1&${gender === "m" ? "gender=masculine&" : ""}${query}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForTimeout(7000);
  await page.getByText("대기", { exact: true }).click();
  await page.getByText("정면", { exact: true }).click();
  await page.waitForTimeout(2500);
  const horizontal = gender === "m" ? MALE_CROP : FEMALE_CROP;
  const vertical = PART_CROPS[part];
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: { x: horizontal.x, y: vertical.y, width: horizontal.w, height: vertical.h },
  });
  console.log("구움", name, errors.slice(0, 2).join(" | "));
  await page.close();
}
await browser.close();
