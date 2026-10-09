// 본편을 실제 크롬으로 띄우는 검사 도구들이 같이 쓰는 준비 코드.
// window.__game 훅(teleport·camera·lobby·view)에 기대므로 개발 서버에서만 돈다.
import { chromium } from "playwright";

/**
 * 창을 띄운 크롬(GPU = Metal)과 1280×720 페이지를 연다.
 * headless 가 아닌 이유: headless WebGL 은 소프트웨어 렌더러라 프레임·화면이 실제와 다르다.
 */
export async function openGamePage(extraArgs = []) {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--use-angle=metal", ...extraArgs],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  return { browser, page };
}

// ?input=always 는 포인터 잠금 없이 조작을 켜서 잠금 경고가 늘 뜬다
export const POINTER_LOCK = /pointer lock/i;

export const isThirdPerson = (page) => page.evaluate(() => window.__game.view.isThirdPerson);
export const heldItem = (page) => page.evaluate(() => window.__game.lobby.lobbyStore.get().heldItem);

/** 물건 앞에 서서 1인칭으로 겨눈다 — 3인칭 카메라는 붐 끝이라 lookAt 이 안 맞는다 */
export async function aimAt(page, position) {
  await page.evaluate(([x, y, z]) => {
    window.__game.teleport(x + 1.1, z + 1.1);
    const camera = window.__game.camera;
    camera.position.set(x + 1.1, camera.position.y, z + 1.1);
    camera.lookAt(x, y, z);
    camera.updateMatrixWorld(true);
  }, position);
  await page.waitForTimeout(700);
}
