// 나주 맵을 헤드리스 크롬으로 띄워 재는 도구들이 같이 쓰는 준비 코드.
// window.__game.naju 훅(scene·camera·gl·terrain·teleport)에 기대므로 개발 서버에서만 돈다.
import { writeFileSync } from "node:fs";

import { chromium } from "playwright";

// 기본 헤드리스는 GL 이 없어 캔버스가 비므로 ANGLE + SwiftShader 를 명시한다.
// 소프트웨어 렌더러라 fps 는 의미 없고 한 프레임이 3~4 초다 — 도구마다 넉넉히 기다린다.
export const SWIFTSHADER_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

export async function openHeadless(viewport, extraArgs = []) {
  const browser = await chromium.launch({ args: [...SWIFTSHADER_ARGS, ...extraArgs] });
  const page = await browser.newPage({ viewport });
  return { browser, page };
}

export function logPageErrors(page, maxLength = 140) {
  page.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, maxLength)));
}

/** 주소를 열고 시작 화면에서 T 로 게임에 들어간다 */
export async function startGame(page, url, settleMs = 3000) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(settleMs);
  await page.keyboard.press("KeyT");
}

/** Leva 폴더를 전부 편다 — 접혀 있으면 안쪽 체크박스가 DOM 에 없다 */
export async function expandLevaFolders(page, settleMs = 800) {
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++)
      document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click());
  });
  await page.waitForTimeout(settleMs);
}

/** 편 Leva 의 여덟 번째 체크박스가 「새 지형」 손잡이다 */
export const toggleBakedTerrain = (page) =>
  page.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());

/** 구운 지형 땅(삼각형 128,000)이 올라올 때까지 5 초씩 기다린다 */
export async function waitForBakedGround(page, tries) {
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(5000);
    const isReady = await page.evaluate(() => {
      const ground = window.__game?.naju?.scene?.getObjectByName("ground");
      return !!ground && (ground.geometry.index?.count ?? 0) / 3 === 128000;
    });
    if (isReady) break;
  }
}

/** 화면 안내문(조작법·Leva 도움말)을 감춰 장면만 남긴다 */
export async function hideHelpText(page, pattern) {
  await page.evaluate((source) => {
    const matcher = new RegExp(source);
    document.querySelectorAll("div").forEach((d) => {
      if (d.children.length === 0 && matcher.test(d.textContent)) {
        let parent = d;
        for (let i = 0; i < 3 && parent.parentElement; i++) parent = parent.parentElement;
        parent.style.display = "none";
      }
    });
  }, pattern);
}

/**
 * 지금 카메라로 한 장 그려 PNG 로 쓴다. 성공하면 true.
 * preserveDrawingBuffer 가 꺼져 있어(켜면 본편 성능 손해) Playwright 스크린샷은 검다.
 * 같은 태스크 안에서 직접 그리고 곧바로 캔버스를 읽으면 버퍼가 살아 있다.
 */
export async function captureCanvas(page, file) {
  const dataUrl = await page.evaluate(() => {
    const naju = window.__game?.naju;
    if (!naju) return null;
    naju.gl.render(naju.scene, naju.camera);
    return naju.gl.domElement.toDataURL("image/png");
  });
  if (!dataUrl) return false;
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  return true;
}

/** center(유닛) 둘레 distance·방위 bearing(라디안)·높이 lift 에 카메라를 두고 outDir/name.png 로 찍는다 */
export async function shootAround(page, outDir, name, center, distance, bearing, lift) {
  await page.evaluate(
    ([target, d, a, up]) => {
      const naju = window.__game.naju;
      const look = new naju.THREE.Vector3(...target);
      const camera = naju.camera;
      camera.position.set(look.x + Math.sin(a) * d, look.y + up, look.z + Math.cos(a) * d);
      camera.lookAt(look);
    },
    [center, distance, bearing, lift],
  );
  await page.waitForTimeout(7000);
  await captureCanvas(page, `${outDir}/${name}.png`);
  console.log("  찍음", name);
}
