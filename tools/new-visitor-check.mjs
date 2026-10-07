// localStorage 를 비운 새 방문자가 어떤 모습으로 시작하는지 본다(기본 외형·성별 단추·색·체형 값).
//   node tools/new-visitor-check.mjs <스크린샷 폴더> [주소]
import { chromium } from "playwright";

const outDir = process.argv[2] ?? ".";
const url = process.argv[3] ?? "http://localhost:5173/";

const browser = await chromium.launch({ headless: false, args: ["--disable-gpu-vsync"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 740 } });
await page.goto(url, { waitUntil: "load" });
await page.evaluate(() => localStorage.clear()); // 처음 오는 사람과 같은 상태
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(26000);
await page.bringToFront();
await page.mouse.click(640, 370);
await page.waitForTimeout(250);
await page.keyboard.press("KeyT");
await page.waitForTimeout(1600);
await page.screenshot({ path: `${outDir}/new-visitor.png` });
const summary = await page.evaluate(() => {
  const genderButtons = [...document.querySelectorAll("button")].filter((b) => /체형$/.test(b.innerText.trim()));
  const colors = [...document.querySelectorAll("input[type=color]")].map((e) => e.value);
  const sliders = [...document.querySelectorAll("input[type=range]")].slice(0, 6).map((e) => e.value);
  return {
    genderButtons: genderButtons.map((b) => b.innerText.trim() + (b.style.background ? "(선택)" : "")),
    colors,
    sliders,
  };
});
await browser.close();
console.log(JSON.stringify(summary));
