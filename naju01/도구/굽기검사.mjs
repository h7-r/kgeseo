// ═══════════════════════════════════════════════════════════════
//  굽기검사.mjs — 내보낸 GLB 가 Meshy 에 넘길 만한 물건인지 재는 자
// ═══════════════════════════════════════════════════════════════
// 쓰는 법  node naju01/도구/굽기검사.mjs
//
// 무엇을 보나
//   ① 삼각형 수 · 실치수 — 씬과 같은 물건이 나왔나
//   ② UV 가 0~1 안에 있나 — 벗어나면 텍스처가 반복돼서 이상하게 나온다
//   ③ **텍셀 밀도** — 계산으로 51 px/m · 98 px/m 을 노렸는데 진짜 그런가.
//      삼각형마다 (UV 넓이 × 4096²) ÷ (실제 넓이) 를 재서 분포를 본다.
//      이게 자릿수로 갈리면 어딘가 늘어났다는 뜻이다.
//   ④ 늘어남(stretch) — 가로세로 밀도가 얼마나 다른가

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 파일 = path.join(여기, "..", "에셋", "원본", "지형.glb");
const 주소 = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";
const 해상도 = 4096;

const 브라우저 = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const 쪽 = await 브라우저.newPage({ viewport: { width: 400, height: 240 } });

try {
  await 쪽.goto(주소, { waitUntil: "load" });
  await 쪽.waitForFunction(() => !!window.__NAJU, null, { timeout: 30000 });
  await 쪽.waitForTimeout(2000);

  // GLB 를 페이지 쪽으로 넘긴다(파일 시스템은 페이지가 못 읽는다)
  const 바이트 = [...(await (await import("node:fs/promises")).readFile(파일))];

  console.log(
    await 쪽.evaluate(
      async ([바이트, 해상도]) => {
        const { GLB풀기, 첫메시 } = window.__NAJU.에셋;
        const gltf = await GLB풀기(new Uint8Array(바이트).buffer);
        const 미터 = 1 / 0.3;
        const 메시 = 첫메시(gltf);
        if (!메시) return "메시를 못 찾았다";
        const geo = 메시.geometry;

        const p = geo.attributes.position;
        const uv = geo.attributes.uv;
        if (!uv) return "⚠ UV 속성이 없다 — Meshy 가 언랩을 시도하고 4만 면에서 거부한다";

        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const 치수 = [
          (bb.max.x - bb.min.x) / 미터,
          (bb.max.y - bb.min.y) / 미터,
          (bb.max.z - bb.min.z) / 미터,
        ];

        let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i);
          if (u < uMin) uMin = u; if (u > uMax) uMax = u;
          if (v < vMin) vMin = v; if (v > vMax) vMax = v;
        }

        // 삼각형마다 텍셀 밀도 = √( UV넓이 × 해상도² / 실넓이 )  [px/m]
        const 밀도 = [];
        let 실넓이합 = 0, 겹침의심 = 0, 뭉갬면적 = 0, 흐림면적 = 0;
        for (let i = 0; i < p.count; i += 3) {
          const ax = p.getX(i) / 미터, ay = p.getY(i) / 미터, az = p.getZ(i) / 미터;
          const bx = p.getX(i+1) / 미터, by = p.getY(i+1) / 미터, bz = p.getZ(i+1) / 미터;
          const cx = p.getX(i+2) / 미터, cy = p.getY(i+2) / 미터, cz = p.getZ(i+2) / 미터;
          const ux = bx-ax, uy = by-ay, uz = bz-az;
          const wx = cx-ax, wy = cy-ay, wz = cz-az;
          const A = 0.5 * Math.hypot(uy*wz-uz*wy, uz*wx-ux*wz, ux*wy-uy*wx);
          if (A < 1e-9) continue;
          실넓이합 += A;
          const a2 = [uv.getX(i), uv.getY(i)];
          const b2 = [uv.getX(i+1), uv.getY(i+1)];
          const c2 = [uv.getX(i+2), uv.getY(i+2)];
          const T = Math.abs(
            (b2[0]-a2[0])*(c2[1]-a2[1]) - (c2[0]-a2[0])*(b2[1]-a2[1]),
          ) / 2;
          if (T < 1e-12) { 겹침의심++; 뭉갬면적 += A; continue; }
          const d = Math.sqrt((T * 해상도 * 해상도) / A);
          밀도.push(d);
          // 면적 기준으로도 센다 — 삼각형 개수만 보면 넓은 면이 묻힌다
          if (d < 12) 뭉갬면적 += A;
          else if (d < 25) 흐림면적 += A;
        }
        밀도.sort((a, b) => a - b);
        const 백분 = (q) => 밀도[Math.floor((밀도.length - 1) * q)];
        // UV 가 실제로 덮은 넓이 = 아틀라스 낭비율
        let uv넓이 = 0;
        for (let i = 0; i < p.count; i += 3) {
          const a2 = [uv.getX(i), uv.getY(i)];
          const b2 = [uv.getX(i+1), uv.getY(i+1)];
          const c2 = [uv.getX(i+2), uv.getY(i+2)];
          uv넓이 += Math.abs(
            (b2[0]-a2[0])*(c2[1]-a2[1]) - (c2[0]-a2[0])*(b2[1]-a2[1]),
          ) / 2;
        }

        const 줄 = [];
        줄.push(`삼각형      ${Math.round(p.count / 3).toLocaleString()}`);
        줄.push(`실치수      ${치수.map((v) => v.toFixed(1)).join(" × ")} m`);
        줄.push(`실표면적    ${Math.round(실넓이합).toLocaleString()} m²`);
        줄.push(
          `UV 범위     u ${uMin.toFixed(3)}~${uMax.toFixed(3)} · v ${vMin.toFixed(3)}~${vMax.toFixed(3)}` +
            (uMin < -1e-4 || uMax > 1.0001 || vMin < -1e-4 || vMax > 1.0001
              ? "   ⚠ 0~1 을 벗어남"
              : "   ✔ 0~1 안"),
        );
        줄.push(`아틀라스 사용률  ${(uv넓이 * 100).toFixed(1)} %  (나머지는 빈 칸)`);
        줄.push(`퇴화 UV     ${겹침의심} 개`);
        줄.push("");
        줄.push(`텍셀 밀도 (${해상도}² 기준, px/m — 클수록 촘촘)`);
        줄.push(`  최저 ${백분(0).toFixed(0)}  ·  하위25% ${백분(0.25).toFixed(0)}` +
                `  ·  중앙 ${백분(0.5).toFixed(0)}  ·  상위25% ${백분(0.75).toFixed(0)}` +
                `  ·  최고 ${백분(1).toFixed(0)}`);
        줄.push(`  중앙값 = ${(1000 / 백분(0.5)).toFixed(1)} mm/텍셀`);
        줄.push("");
        줄.push("면적으로 본 늘어남 (위에서 편 투영이 서 있는 면을 뭉갠다)");
        줄.push(`  심함(<12 px/m)  ${뭉갬면적.toFixed(0).padStart(5)} m²  ${(뭉갬면적/실넓이합*100).toFixed(1)} %`);
        줄.push(`  흐림(<25 px/m)  ${흐림면적.toFixed(0).padStart(5)} m²  ${(흐림면적/실넓이합*100).toFixed(1)} %`);
        줄.push(`  쓸만함          ${(실넓이합-뭉갬면적-흐림면적).toFixed(0).padStart(5)} m²  ${((실넓이합-뭉갬면적-흐림면적)/실넓이합*100).toFixed(1)} %`);
        return 줄.join("\n");
      },
      [바이트, 해상도],
    ),
  );
} finally {
  await 브라우저.close();
}
