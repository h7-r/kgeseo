// localStorage 를 비운 **새 방문자**가 어떤 모습으로 시작하는지 본다.
import { chromium } from "playwright";
const S = process.argv[2];
const b = await chromium.launch({ headless: false, args: ["--disable-gpu-vsync"] });
const p = await b.newPage({ viewport: { width: 1280, height: 740 } });
await p.goto("http://localhost:5173/", { waitUntil: "load" });
await p.evaluate(() => localStorage.clear());      // 처음 오는 사람과 같은 상태
await p.reload({ waitUntil: "load" });
await p.waitForTimeout(26000);
await p.bringToFront(); await p.mouse.click(640, 370); await p.waitForTimeout(250);
await p.keyboard.press("KeyT"); await p.waitForTimeout(1600);
await p.screenshot({ path: `${S}/기본_새방문자.png` });
const r = await p.evaluate(() => {
  const 고름 = [...document.querySelectorAll("button")].filter((b2) => /체형$/.test(b2.innerText.trim()));
  const 색 = [...document.querySelectorAll('input[type=color]')].map((e) => e.value);
  const 슬 = [...document.querySelectorAll('input[type=range]')].slice(0, 6).map((e) => e.value);
  return { 성별버튼: 고름.map((b2) => b2.innerText.trim() + (b2.style.background ? "(선택)" : "")), 색, 슬 };
});
await b.close();
console.log(JSON.stringify(r));
