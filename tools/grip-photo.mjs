// 1인칭에서 물건을 하나씩 집고 화면을 찍는다(쥠표·「1인칭 손」 값 맞추기용).
//
//   node tools/grip-photo.mjs <저장폴더> <id,id,...> [variants.json]
//
//   variants.json = [{ "name": "a", "grip": {"mug": {...}}, "leva": {"1인칭 손.forward": 0.9}, "cutNear": 0.18 }, ...]
//     · grip    → __game.gripOffsets(kind, spec)   (src/lobby/gripTable.ts — 종류·필드는 GripSpec 영어 이름)
//     · leva    → __game.leva.setValueAtPath("폴더.key", 값)   (한글 label 경로 "1인칭 손.앞" 도 받는다)
//     · cutNear → __game.clipping.near, cutBack → __game.clipping.bodyBack   (naju01 치비 아바타의 1인칭 잘림면, m)
//   한 번 집은 채로 변형마다 바꿔 찍는다 — 페이지를 다시 띄우지 않아 빠르다.
//
//   환경변수
//     PITCH="front:-0.15,down:-0.55"  고개 각(이름:라디안)
//     THIRD=1                          집은 뒤 3인칭으로 찍는다(카메라는 붐이 잡아 피치를 안 건드린다)
//     GAME_URL=...                     기본 http://localhost:5173/?input=always
//
//   [미리] 개발 서버가 떠 있어야 한다: npx vite --port 5173
import { readFileSync } from "node:fs";

import { aimAt, heldItem, isThirdPerson, openGamePage, POINTER_LOCK } from "./gamePage.mjs";

const outDir = process.argv[2] ?? ".";
const itemIds = (process.argv[3] ?? "mug0,kb0,ms0,laptop1,E-06,hat0").split(",");
const variants = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : [{ name: "default" }];
const pitches = (process.env.PITCH ?? "front:-0.15,down:-0.55").split(",").map((entry) => {
  const [name, value] = entry.split(":");
  return [name, Number(value)];
});
const url = process.env.GAME_URL ?? "http://localhost:5173/?input=always";

const { browser, page } = await openGamePage();
const errors = [];
page.on("pageerror", (e) => {
  if (!POINTER_LOCK.test(e.message)) errors.push(e.message);
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(
  () => {
    const g = window.__game;
    return !!(g?.view && g.camera && g.lobby && g.targets && g.leva && g.teleport);
  },
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(12000);
await page.bringToFront();

/** 화면을 덮는 패널(Leva·HUD)을 가려 캔버스만 남긴다 */
async function hideOverlays() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (
        (cs.position === "fixed" || cs.position === "absolute") &&
        !el.querySelector("canvas") &&
        el.tagName !== "CANVAS"
      )
        el.style.visibility = "hidden";
    }
  });
}

/** 열린 창(힌트함·인벤토리)을 닫고 1인칭으로 맞춘다 — 창이 떠 있으면 조작이 멈춘다 */
async function prepare() {
  for (let i = 0; i < 3; i += 1) {
    const dialogOpen = await page.evaluate(() =>
      [...document.querySelectorAll("*")].some((e) => e.childElementCount === 0 && /로 닫기/.test(e.textContent || "")),
    );
    if (!dialogOpen) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
  for (let i = 0; i < 3 && (await isThirdPerson(page)); i += 1) {
    await page.keyboard.press("KeyV");
    await page.waitForTimeout(1300);
  }
}

async function applyVariant(variant) {
  await page.evaluate((v) => {
    const game = window.__game;
    game.gripOffsets(); // 전부 지우고 다시 건다
    for (const [kind, spec] of Object.entries(v.grip ?? {})) game.gripOffsets(kind, spec);

    // 키는 영어, 폴더 이름은 한글이다. 한글 label 로 적은 변형 파일 경로도 찾아 준다.
    const data = game.leva.getData();
    const resolvePath = (path) => {
      if (path in data) return path;
      const cut = path.lastIndexOf(".");
      const folder = path.slice(0, cut);
      const label = path.slice(cut + 1);
      return (
        Object.keys(data).find((p) => p.slice(0, p.lastIndexOf(".")) === folder && data[p].label === label) ?? path
      );
    };
    for (const [path, value] of Object.entries(v.leva ?? {})) game.leva.setValueAtPath(resolvePath(path), value, true);

    // 잘림면은 naju01 치비 아바타가 __game.clipping 으로 연다
    if (v.cutNear != null && game.clipping) game.clipping.near = v.cutNear;
    if (v.cutBack != null && game.clipping) game.clipping.bodyBack = v.cutBack;
  }, variant);
}

const returnHeld = async () => {
  await page.evaluate(() => window.__game.lobby.returnHeld());
  await page.waitForTimeout(900);
};

const targets = await page.evaluate(() => window.__game.targets().map((t) => ({ id: t.id, position: t.position })));
for (const id of itemIds) {
  const item = targets.find((t) => t.id === id || t.id === `pickup:${id}`);
  if (!item) {
    console.log("없음", id);
    continue;
  }
  await prepare();
  await applyVariant(variants[0]);
  await aimAt(page, item.position);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(1500);
  console.log(id, "heldItem", await heldItem(page));
  await hideOverlays();

  if (process.env.THIRD) {
    await page.keyboard.press("KeyV");
    await page.waitForTimeout(1800);
    for (const v of variants) {
      await applyVariant(v);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${outDir}/${id}-${v.name}-third.png` });
    }
    await page.keyboard.press("KeyV");
    await page.waitForTimeout(1300);
    await returnHeld();
    continue;
  }

  for (const v of variants) {
    await applyVariant(v);
    for (const [name, pitch] of pitches) {
      await page.evaluate((angle) => {
        const camera = window.__game.camera;
        camera.rotation.order = "YXZ";
        camera.rotation.set(angle, camera.rotation.y, 0, "YXZ");
        camera.updateMatrixWorld(true);
      }, pitch);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${outDir}/${id}-${v.name}-${name}.png` });
    }
  }
  // 놓을 자리를 겨누지 않고 제자리로 돌려놓는다(다음 물건이 꼬이지 않게)
  await returnHeld();
}
console.log("오류", errors.slice(0, 5));
await browser.close();
