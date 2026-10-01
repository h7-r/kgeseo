// 쥠사진.mjs — 1인칭에서 물건을 하나씩 집고 **화면을 찍는다** (쥠표·「1인칭 손」 값 맞추기용)
//
//   node 도구/쥠사진.mjs <저장폴더> <id,id,...> [변형들.json]
//
//   변형들.json = [{ "이름": "a", "쥠덧": {"머그": {...}}, "레바": {"1인칭 손.앞": 0.9}, "잘림": 0.18 }, ...]
//     · 쥠덧 → __쥠덧(종류, 값)   (쥠표.js)
//     · 레바 → __레바.setValueAtPath(경로, 값)   (Leva 슬라이더)
//     · 잘림 → __잘림.앞   (치비게임아바타 1인칭 잘림면, m)
//   한 번 집은 채로 변형마다 바꿔 가며 찍는다 — 페이지를 다시 띄우지 않아 빠르다.
//   피치(고개 각)는 환경변수로: PITCH="앞:-0.15,숙임:-0.55"
//
//   [미리] 개발 서버가 떠 있어야 한다: npx vite --port 5173
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const 폴더 = process.argv[2] ?? ".";
const 뽑을 = (process.argv[3] ?? "mug0,kb0,ms0,laptop1,E-06,hat0").split(",");
const 변형들 = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : [{ 이름: "기본" }];
const 피치들 = (process.env.PITCH ?? "앞:-0.15,숙임:-0.55").split(",").map((x) => {
  const [a, b] = x.split(":");
  return [a, Number(b)];
});

const 브라우저 = await chromium.launch({ headless: false, args: ["--use-angle=metal"] });
const 쪽 = await 브라우저.newPage({ viewport: { width: 1280, height: 720 } });
const 오류 = [];
쪽.on("pageerror", (e) => { if (!/pointer lock/i.test(e.message)) 오류.push(e.message); });
await 쪽.goto("http://localhost:5173/?조작=항상", { waitUntil: "domcontentloaded", timeout: 60000 });
await 쪽.waitForFunction(() => window.__내자리 && window.__카메라 && window.__로비 && window.__대상목록 && window.__레바, null, { timeout: 90000 });
await 쪽.waitForTimeout(12000);
await 쪽.bringToFront();

async function 가리기() {
  // 화면을 덮는 패널(Leva·꾸미기·HUD)을 가린다 — 캔버스만 남긴다
  await 쪽.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if ((cs.position === "fixed" || cs.position === "absolute") && !el.querySelector("canvas") && el.tagName !== "CANVAS")
        el.style.visibility = "hidden";
    }
  });
}
async function 준비() {
  // 튜토리얼 창(힌트함 등)이 떠 있으면 조작이 멈춘다 — 닫는다
  for (let i = 0; i < 3; i += 1) {
    const 창 = await 쪽.evaluate(() =>
      [...document.querySelectorAll("*")].some((e) => e.childElementCount === 0 && /로 닫기/.test(e.textContent || "")));
    if (!창) break;
    await 쪽.keyboard.press("Escape");
    await 쪽.waitForTimeout(600);
  }
  for (let i = 0; i < 3 && (await 쪽.evaluate(() => window.__내자리.삼인칭)); i += 1) {
    await 쪽.keyboard.press("KeyV");
    await 쪽.waitForTimeout(1300);
  }
}
async function 변형적용(v) {
  await 쪽.evaluate((v) => {
    window.__쥠덧(); // 전부 지우고
    for (const [k, 값] of Object.entries(v.쥠덧 ?? {})) window.__쥠덧(k, 값);
    for (const [경로, 값] of Object.entries(v.레바 ?? {})) window.__레바.setValueAtPath(경로, 값, true);
    if (v.잘림 != null && window.__잘림) window.__잘림.앞 = v.잘림;
    if (v.몸뒤 != null && window.__잘림) window.__잘림.몸뒤 = v.몸뒤;
  }, v);
}

const 목록 = await 쪽.evaluate(() => window.__대상목록().map((x) => ({ id: x.id, 위치: x.위치 })));
for (const id of 뽑을) {
  const 물건 = 목록.find((x) => x.id === id || x.id === "집기:" + id);
  if (!물건) { console.log("없음", id); continue; }
  await 준비();
  await 변형적용(변형들[0]);
  const [x, y, z] = 물건.위치;
  await 쪽.evaluate(([x, y, z]) => {
    window.__순간이동(x + 1.1, z + 1.1);
    const c = window.__카메라;
    c.position.set(x + 1.1, c.position.y, z + 1.1);
    c.lookAt(x, y, z);
    c.updateMatrixWorld(true);
  }, [x, y, z]);
  await 쪽.waitForTimeout(700);
  await 쪽.keyboard.press("KeyE");
  await 쪽.waitForTimeout(1500);
  const 든 = await 쪽.evaluate(() => window.__로비.로비상태.값().든것);
  console.log(id, "든것", 든);
  await 가리기();
  // THIRD=1 이면 집은 뒤 3인칭으로 돌려 찍는다(카메라는 붐이 잡으므로 피치를 안 건드린다)
  if (process.env.THIRD) {
    await 쪽.keyboard.press("KeyV");
    await 쪽.waitForTimeout(1800);
    for (const v of 변형들) {
      await 변형적용(v);
      await 쪽.waitForTimeout(700);
      await 쪽.screenshot({ path: `${폴더}/${id}-${v.이름}-삼인칭.png` });
    }
    await 쪽.keyboard.press("KeyV");
    await 쪽.waitForTimeout(1300);
    await 쪽.evaluate(() => window.__로비.제자리로());
    await 쪽.waitForTimeout(900);
    continue;
  }
  for (const v of 변형들) {
    await 변형적용(v);
    for (const [이름, 피치] of 피치들) {
      await 쪽.evaluate((p) => {
        const c = window.__카메라;
        c.rotation.order = "YXZ";
        c.rotation.set(p, c.rotation.y, 0, "YXZ");
        c.updateMatrixWorld(true);
      }, 피치);
      await 쪽.waitForTimeout(700);
      await 쪽.screenshot({ path: `${폴더}/${id}-${v.이름}-${이름}.png` });
    }
  }
  // 놓을 자리를 겨누는 수고 없이 **제자리로** 돌려놓는다(다음 물건이 꼬이지 않게)
  await 쪽.evaluate(() => window.__로비.제자리로());
  await 쪽.waitForTimeout(900);
}
console.log("오류", 오류.slice(0, 5));
await 브라우저.close();
