// 내보낸 지형 GLB 가 Meshy 에 넘길 만한지 잰다.
// 쓰는 법  node naju01/tools/check-bake.mjs
//
// 삼각형 수·실치수, UV 가 0~1 안인지(벗어나면 반복돼 이상하다),
// 텍셀 밀도(노린 51 · 98 px/m 이 맞나 — 자릿수로 갈리면 어딘가 늘어났다), 늘어남을 본다.

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const glbPath = path.join(here, "..", "assets", "source", "terrain.glb");
const url = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";
const resolution = 4096;

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__game?.naju, null, { timeout: 30000 });
  await page.waitForTimeout(2000);

  // 페이지는 파일 시스템을 못 읽어 바이트로 넘긴다
  const bytes = [...(await (await import("node:fs/promises")).readFile(glbPath))];

  console.log(
    await page.evaluate(
      async ([bytes, resolution]) => {
        const { parseGlb, firstMesh } = window.__game.naju.assets;
        const gltf = await parseGlb(new Uint8Array(bytes).buffer);
        const METER = 1 / 0.3;
        const mesh = firstMesh(gltf);
        if (!mesh) return "메시를 못 찾았다";
        const geo = mesh.geometry;

        const p = geo.attributes.position;
        const uv = geo.attributes.uv;
        if (!uv) return "⚠ UV 속성이 없다 — Meshy 가 언랩을 시도하고 4만 면에서 거부한다";

        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const size = [(bb.max.x - bb.min.x) / METER, (bb.max.y - bb.min.y) / METER, (bb.max.z - bb.min.z) / METER];

        let uMin = 1e9,
          uMax = -1e9,
          vMin = 1e9,
          vMax = -1e9;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i),
            v = uv.getY(i);
          if (u < uMin) uMin = u;
          if (u > uMax) uMax = u;
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }

        // 삼각형마다 텍셀 밀도 = √(UV넓이 × 해상도² / 실넓이)  [px/m]
        const densities = [];
        let realAreaSum = 0,
          degenerateCount = 0,
          smearedArea = 0,
          blurryArea = 0;
        for (let i = 0; i < p.count; i += 3) {
          const ax = p.getX(i) / METER,
            ay = p.getY(i) / METER,
            az = p.getZ(i) / METER;
          const bx = p.getX(i + 1) / METER,
            by = p.getY(i + 1) / METER,
            bz = p.getZ(i + 1) / METER;
          const cx = p.getX(i + 2) / METER,
            cy = p.getY(i + 2) / METER,
            cz = p.getZ(i + 2) / METER;
          const ux = bx - ax,
            uy = by - ay,
            uz = bz - az;
          const wx = cx - ax,
            wy = cy - ay,
            wz = cz - az;
          const A = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
          if (A < 1e-9) continue;
          realAreaSum += A;
          const a2 = [uv.getX(i), uv.getY(i)];
          const b2 = [uv.getX(i + 1), uv.getY(i + 1)];
          const c2 = [uv.getX(i + 2), uv.getY(i + 2)];
          const T = Math.abs((b2[0] - a2[0]) * (c2[1] - a2[1]) - (c2[0] - a2[0]) * (b2[1] - a2[1])) / 2;
          if (T < 1e-12) {
            degenerateCount++;
            smearedArea += A;
            continue;
          }
          const d = Math.sqrt((T * resolution * resolution) / A);
          densities.push(d);
          // 개수만 보면 넓은 면이 묻혀 면적으로도 센다
          if (d < 12) smearedArea += A;
          else if (d < 25) blurryArea += A;
        }
        densities.sort((a, b) => a - b);
        const percentile = (q) => densities[Math.floor((densities.length - 1) * q)];
        // UV 가 실제로 덮은 넓이 = 아틀라스 사용률
        let uvArea = 0;
        for (let i = 0; i < p.count; i += 3) {
          const a2 = [uv.getX(i), uv.getY(i)];
          const b2 = [uv.getX(i + 1), uv.getY(i + 1)];
          const c2 = [uv.getX(i + 2), uv.getY(i + 2)];
          uvArea += Math.abs((b2[0] - a2[0]) * (c2[1] - a2[1]) - (c2[0] - a2[0]) * (b2[1] - a2[1])) / 2;
        }

        const lines = [];
        lines.push(`삼각형      ${Math.round(p.count / 3).toLocaleString()}`);
        lines.push(`실치수      ${size.map((v) => v.toFixed(1)).join(" × ")} m`);
        lines.push(`실표면적    ${Math.round(realAreaSum).toLocaleString()} m²`);
        lines.push(
          `UV 범위     u ${uMin.toFixed(3)}~${uMax.toFixed(3)} · v ${vMin.toFixed(3)}~${vMax.toFixed(3)}` +
            (uMin < -1e-4 || uMax > 1.0001 || vMin < -1e-4 || vMax > 1.0001 ? "   ⚠ 0~1 을 벗어남" : "   ✔ 0~1 안"),
        );
        lines.push(`아틀라스 사용률  ${(uvArea * 100).toFixed(1)} %  (나머지는 빈 칸)`);
        lines.push(`퇴화 UV     ${degenerateCount} 개`);
        lines.push("");
        lines.push(`텍셀 밀도 (${resolution}² 기준, px/m — 클수록 촘촘)`);
        lines.push(
          `  최저 ${percentile(0).toFixed(0)}  ·  하위25% ${percentile(0.25).toFixed(0)}` +
            `  ·  중앙 ${percentile(0.5).toFixed(0)}  ·  상위25% ${percentile(0.75).toFixed(0)}` +
            `  ·  최고 ${percentile(1).toFixed(0)}`,
        );
        lines.push(`  중앙값 = ${(1000 / percentile(0.5)).toFixed(1)} mm/텍셀`);
        lines.push("");
        lines.push("면적으로 본 늘어남 (위에서 편 투영이 서 있는 면을 뭉갠다)");
        lines.push(
          `  심함(<12 px/m)  ${smearedArea.toFixed(0).padStart(5)} m²  ${((smearedArea / realAreaSum) * 100).toFixed(1)} %`,
        );
        lines.push(
          `  흐림(<25 px/m)  ${blurryArea.toFixed(0).padStart(5)} m²  ${((blurryArea / realAreaSum) * 100).toFixed(1)} %`,
        );
        lines.push(
          `  쓸만함          ${(realAreaSum - smearedArea - blurryArea).toFixed(0).padStart(5)} m²  ${(((realAreaSum - smearedArea - blurryArea) / realAreaSum) * 100).toFixed(1)} %`,
        );
        return lines.join("\n");
      },
      [bytes, resolution],
    ),
  );
} finally {
  await browser.close();
}
