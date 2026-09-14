// ═══════════════════════════════════════════════════════════════
//  내보내기.mjs — 지형 한 덩이를 GLB 로 뽑는다 (Meshy 업로드용)
// ═══════════════════════════════════════════════════════════════
// 쓰는 법
//   ① 개발 서버를 띄운다      npx vite naju01     → http://localhost:5174
//   ② 다른 창에서            node naju01/도구/내보내기.mjs
//   ③ naju01/에셋/원본/지형.glb 가 생긴다 → Meshy 에 업로드
//
// [왜 브라우저를 거치나]
//   지형은 씬이 켜질 때 코드로 만들어진다. 그 결과물을 그대로 뽑아야
//   **화면에 보이는 것과 굽는 것이 같다.** 노드에서 따로 다시 만들면
//   설정 하나만 어긋나도 다른 물건이 나온다.
//
// [Meshy 에 넘길 때]
//   enable_original_uv: true   ← 우리가 얹은 UV 를 쓰라는 뜻. 반드시 켠다.
//                                끄면 Meshy 가 UV 를 새로 푸는데, 그 기능은
//                                삼각형 4만 면까지만 받아서 거부당한다.
//   enable_pbr: true
//   texture_resolution: "4k"
//   remove_lighting: true      ← 텍스처에 조명이 구워지면 우리 해와 충돌한다

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 나갈곳 = path.join(여기, "..", "에셋", "원본");
// --정점색 을 붙이면 우리 흙·바위 색을 실어 보낸다.
//   첫 굽기(색 없이)가 거의 백색 단색으로 돌아와서 만든 선택지다 — README 참고.
const 정점색 = process.argv.includes("--정점색");
// --밑그림 : 우리 흙·바위 색을 **그림으로 구워** baseColorTexture 로 넣는다.
//   Meshy 가 COLOR_0(정점색 속성)에서 모델 처리 실패를 내서 만든 길이다.
const 밑그림 = process.argv.includes("--밑그림");
// --칸 바닥 | --칸 절벽 : 그 칸만 뽑는다.
//   Meshy 는 한 모델에 **재질 하나**만 입힌다(1·2차로 확인). 절벽과 땅을
//   같이 넘기면 둘이 한 가지 회색으로 뭉개진다. 따로 구워서 **우리가 합친다.**
//   UV 는 전체 아틀라스 자리를 그대로 쓰므로 합치는 데 계산이 필요 없다.
const 칸번호 = process.argv.indexOf("--칸");
const 칸 = 칸번호 >= 0 ? process.argv[칸번호 + 1] : null;
// --구역 Z1 : 바닥 칸에서 **그 구역 사각형 안**만 뽑는다.
//   바닥 칸 하나로 구우면 Z1 다진 흙 · Z2 자갈 · Z4 풀능선이 전부 같은 재질이
//   된다(Meshy 는 한 모델에 재질 하나). 구역마다 따로 굽고 우리가 합친다.
//   아틀라스 사각형은 GLB 옆 .json 에 같이 적어 둔다 — 합칠 때 그걸 읽는다.
const 구역번호 = process.argv.indexOf("--구역");
const 구역코드 = 구역번호 >= 0 ? process.argv[구역번호 + 1] : null;
const 주소 = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";

await fs.mkdir(나갈곳, { recursive: true });

const 브라우저 = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const 쪽 = await 브라우저.newPage({ viewport: { width: 400, height: 240 } });
const 오류 = [];
쪽.on("pageerror", (e) => 오류.push(String(e)));

try {
  await 쪽.goto(주소, { waitUntil: "load" });
  await 쪽.waitForFunction(() => !!window.__NAJU?.지형GLB, null, { timeout: 30000 });
  await 쪽.waitForTimeout(2500); // 지형이 다 만들어질 시간

  const 결과 = await 쪽.evaluate(async (k) => {
    const T = window.__NAJU;
    let 구역 = null;
    let 사각형 = null;
    if (k.구역코드) {
      const z = T.구역목록().find((v) => v.코드 === k.구역코드);
      if (!z) throw new Error(`구역 ${k.구역코드} 를 못 찾았다`);
      사각형 = T.바닥칸사각형(z.X, z.Z);
      // UV 를 0~1 로 펴서 넘긴다(Meshy 의 「UV 커버리지가 너무 작다」 회피).
      // 돌아온 그림은 **전체가 이 사각형**이므로 쪽지에 `채움: true` 를 적는다.
      구역 = { X: z.X, Z: z.Z, 사각형 };
      사각형 = { ...사각형, 채움: true };
    }
    const { 버퍼, 통계 } = await T.지형GLB({
      정점색: k.정점색,
      밑그림: k.밑그림,
      칸: k.구역코드 ? "바닥" : k.칸,
      구역,
      밑그림크기: 2048,
    });
    // ArrayBuffer 는 그대로 못 넘긴다 — 숫자 배열로 바꿔 보낸다
    return { 바이트: Array.from(new Uint8Array(버퍼)), 통계, 사각형 };
  }, { 정점색, 밑그림, 칸, 구역코드 });

  const 꼬리 =
    (구역코드 ? `-${구역코드}` : 칸 ? `-${칸}` : "") +
    (밑그림 ? "-밑그림" : 정점색 ? "-정점색" : "");
  const 파일 = path.join(나갈곳, `지형${꼬리}.glb`);
  await fs.writeFile(파일, Buffer.from(결과.바이트));
  const 크기 = (결과.바이트.length / 1048576).toFixed(2);

  console.log("── 내보냄 ──────────────────────────────");
  console.log(`  ${파일}`);
  console.log(`  ${크기} MB   (Meshy 업로드 한도 100 MB)`);
  for (const [칸, 수] of Object.entries(결과.통계))
    console.log(`  ${칸} 칸: ${Math.round(수).toLocaleString()} 삼각형`);
  if (결과.사각형) {
    // 아틀라스 사각형을 옆에 적어 둔다 — 합치는 도구가 **다시 계산하지 않게**
    const 쪽지 = 파일.replace(/\.glb$/, ".json");
    await fs.writeFile(쪽지, JSON.stringify(결과.사각형, null, 2));
    console.log(
      `  아틀라스 사각형  u ${결과.사각형.u.map((v) => v.toFixed(4)).join("~")} · v ${결과.사각형.v.map((v) => v.toFixed(4)).join("~")}  → ${path.basename(쪽지)}`,
    );
  }
  if (오류.length) console.log("  ⚠ 페이지 오류:\n   " + 오류.join("\n   "));
} finally {
  await 브라우저.close();
}
