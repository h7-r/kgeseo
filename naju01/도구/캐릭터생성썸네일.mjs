// 카탈로그 카드 썸네일 굽기 — gait.html 의 실제 모델을 찍어 잘라 낸다.
//   node naju01/도구/캐릭터생성썸네일.mjs   (개발 서버 5174 필요)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const 방 = fileURLToPath(new URL("../../public/thumbs/캐릭터생성/", import.meta.url));
mkdirSync(방, { recursive: true });

// [파일이름, 주소값, 자를곳(남자 기준), 자를곳(여자 기준)]
// gait.html 정면: 남자는 화면 가운데(x≈700), 여자는 오른쪽(x≈1060) 근처.
const 남 = { x: 560, w: 300 };
const 여 = { x: 900, w: 300 };
const 부위 = {
  head: { y: 90, h: 190 },
  torso: { y: 230, h: 230 },
  hips: { y: 360, h: 230 },
  feet: { y: 560, h: 170 },
};
const 목록 = [
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

const 브 = await chromium.launch({ channel: "chrome", headless: false });
for (const [이름, 값, 부위이름, 성] of 목록) {
  const 쪽 = await 브.newPage({ viewport: { width: 1400, height: 800 } });
  await 쪽.goto(`http://localhost:5174/gait.html?toon=1&outline=1&${값}`, { waitUntil: "networkidle" });
  await 쪽.waitForTimeout(7000);
  await 쪽.getByText("대기", { exact: true }).click();
  await 쪽.getByText("정면", { exact: true }).click();
  await 쪽.waitForTimeout(2200);
  const 가로 = 성 === "m" ? 남 : 여;
  const 세로 = 부위[부위이름];
  await 쪽.screenshot({ path: `${방}/${이름}.png`, clip: { x: 가로.x, y: 세로.y, width: 가로.w, height: 세로.h } });
  console.log("구움", 이름);
  await 쪽.close();
}
await 브.close();
