// 같은 시점에서 **옛 지형 / 새 지형**을 각각 찍어 나란히 본다.
//   쓰는 법: node naju01/도구/화면찍기.mjs <주소> <내보낼 폴더> [새지형]
// ※ 헤드리스는 SwiftShader라 한 프레임이 3~4 초다. 넉넉히 기다린다.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [주소, 폴더, 어느] = process.argv.slice(2);
mkdirSync(폴더, { recursive: true });
// ★ 헤드리스에서 WebGL 화면이 **검게** 나오는 걸 막는 설정.
//   ① 기본 헤드리스는 GL 이 없어 캔버스가 빈 채로 캡처된다 →
//      ANGLE+SwiftShader 를 명시하고 소프트웨어 래스터라이저를 허용한다.
//   ② `preserveDrawingBuffer` 가 꺼져 있으면 프레젠트 직후 버퍼가 비워져
//      스크린샷에 안 잡힌다 → three 에 그 옵션을 켜라고 알려 준다.
const 브 = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
  ],
});
const 쪽 = await 브.newPage({ viewport: { width: 1280, height: 760 } });
쪽.on("pageerror", (e) => console.log("  pageerror:", (e.message || "").slice(0, 140)));
await 쪽.goto(주소, { waitUntil: "networkidle" });
await 쪽.waitForTimeout(3000);
await 쪽.keyboard.press("KeyT");
await 쪽.waitForTimeout(2500);
// Leva 를 펴고, 필요하면 새지형을 켠다 → 그리고 패널을 접어 화면을 비운다
await 쪽.evaluate(() => { for (let i = 0; i < 4; i++) document.querySelectorAll('[class*="leva"] svg').forEach((s) => s.closest("div")?.parentElement?.click()); });
await 쪽.waitForTimeout(800);
if (어느 === "새지형") {
  await 쪽.evaluate(() => document.querySelectorAll('input[type="checkbox"]')[7].click());
  for (let i = 0; i < 16; i++) {
    await 쪽.waitForTimeout(5000);
    const 됨 = await 쪽.evaluate(() => {
      const m = window.__NAJU?.scene?.getObjectByName("땅");
      return m ? (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 === 128000 : false;
    });
    if (됨) break;
  }
  await 쪽.waitForTimeout(20000);   // 이펙트 커밋 + 몇 프레임
}
// 계기판·Leva·안내문을 숨겨 화면만 남긴다 (H 가 계기판 토글)
await 쪽.keyboard.press("KeyH");
await 쪽.evaluate(() => {
  document.querySelectorAll('[class*="leva"]').forEach((e) => (e.style.display = "none"));
  [...document.querySelectorAll("div")].forEach((d) => {
    if (d.children.length === 0 && /WASD 이동|Leva 아래쪽/.test(d.textContent)) {
      let p = d; for (let i = 0; i < 3 && p.parentElement; i++) p = p.parentElement;
      p.style.display = "none";
    }
  });
});
const 시점 = [
  ["구렁이_가까이", 21.2, 37.6, 2.2],
  ["구렁이_옆에서", 25.5, 40.5, -1.9],
  ["구렁이_멀리", 18, 35, 2.4],
];
for (const [이름, X, Z, 방위] of 시점) {
  await 쪽.evaluate(([x, z, a]) => window.__NAJU?.텔레포트?.current?.(x, z, a), [X, Z, 방위]);
  await 쪽.waitForTimeout(9000);   // 프레임 두세 장
  // ★ Playwright 의 스크린샷으로는 **검은 화면**이 나온다.
  //   캔버스가 `preserveDrawingBuffer: false` 라 프레젠트 직후 버퍼가 비워져,
  //   캡처 시점엔 읽을 게 없다. 그 옵션을 켜면 본편 성능에 손해다.
  //   대신 **직접 한 번 그리고 그 자리에서** 캔버스를 읽는다 — 같은 태스크
  //   안에서는 버퍼가 아직 살아 있다.
  const 자료 = await 쪽.evaluate(() => {
    const N = window.__NAJU;
    if (!N) return null;
    N.gl.render(N.scene, N.camera);
    return N.gl.domElement.toDataURL("image/png");
  });
  if (!자료) { console.log("  ★ 캔버스를 못 읽었다", 이름); continue; }
  writeFileSync(`${폴더}/${이름}.png`, Buffer.from(자료.split(",")[1], "base64"));
  console.log("  찍음", 이름);
}
await 브.close();
