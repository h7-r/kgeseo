// 지형 한 덩이를 GLB 로 뽑는다(Meshy 업로드용).
// 쓰는 법
//   1) 개발 서버를 띄운다      npx vite naju01     → http://localhost:5174
//   2) 다른 창에서            node naju01/tools/export-terrain.mjs [--cell ground|cliff] [--zone Z1] [--underpaint | --vertex-colors]
//   3) naju01/assets/source/terrain*.glb 가 생긴다 → Meshy 에 업로드
// Meshy 설정: enable_original_uv true(끄면 4만 면 제한에 걸린다) · enable_pbr true · texture_resolution "4k" · remove_lighting true(구운 조명이 우리 해와 충돌)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

// 브라우저를 거치는 건 화면에 보이는 지형과 굽는 지형을 같게 하려고다 — 노드에서 다시 만들면 설정 하나만 어긋나도 다른 물건이 나온다
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "assets", "source");
const args = process.argv;

const optionValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

// 색 없이 넘기면 거의 흰 단색으로 돌아와, 흙·바위 색을 꼭짓점 색으로 실어 보낼 수 있게 한다
const vertexColors = args.includes("--vertex-colors");
// Meshy 는 COLOR_0 를 처리하지 못해, 색을 그림으로 구워 baseColorTexture 로 넣는 길도 둔다
const underpaint = args.includes("--underpaint");
// Meshy 는 한 모델에 재질 하나만 입힌다 — 칸별로 따로 굽고 우리가 합친다(UV 는 전체 아틀라스 자리라 계산이 필요 없다)
const cell = optionValue("--cell");
// 구역마다 따로 굽는다(Z1 다진 흙 · Z2 자갈 · Z4 풀능선이 한 재질로 뭉개지지 않게). 아틀라스 사각형은 옆 .json 에 적는다
const zoneCode = optionValue("--zone");
const url = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__game?.naju?.exportTerrainGlb, null, { timeout: 30000 });
  await page.waitForTimeout(2500); // 지형이 다 만들어질 시간

  const result = await page.evaluate(
    async (k) => {
      const naju = window.__game.naju;
      let zone = null;
      let rect = null;
      if (k.zoneCode) {
        const z = naju.zoneList().find((candidate) => candidate.code === k.zoneCode);
        if (!z) throw new Error(`구역 ${k.zoneCode} 를 못 찾았다`);
        rect = naju.groundCellRect(z.x, z.z);
        // UV 를 0~1 로 펴서 넘긴다(Meshy 「UV 커버리지가 너무 작다」 회피) — 돌아온 그림 전체가 이 사각형이라 fill 을 적는다
        zone = { x: z.x, z: z.z, rect };
        rect = { ...rect, fill: true };
      }
      const { buffer, stats } = await naju.exportTerrainGlb({
        vertexColors: k.vertexColors,
        underpaint: k.underpaint,
        cell: k.zoneCode ? "ground" : k.cell,
        zone,
        underpaintSize: 2048,
      });
      // ArrayBuffer 는 그대로 못 넘긴다 — 숫자 배열로 바꿔 보낸다
      return { bytes: Array.from(new Uint8Array(buffer)), stats, rect };
    },
    { vertexColors, underpaint, cell, zoneCode },
  );

  const suffix =
    (zoneCode ? `-${zoneCode}` : cell ? `-${cell}` : "") +
    (underpaint ? "-underpaint" : vertexColors ? "-vertex-colors" : "");
  const file = path.join(outDir, `terrain${suffix}.glb`);
  await fs.writeFile(file, Buffer.from(result.bytes));
  const sizeMb = (result.bytes.length / 1048576).toFixed(2);

  console.log("── 내보냄 ──────────────────────────────");
  console.log(`  ${file}`);
  console.log(`  ${sizeMb} MB   (Meshy 업로드 한도 100 MB)`);
  for (const [cellName, count] of Object.entries(result.stats))
    console.log(`  ${cellName} 칸: ${Math.round(count).toLocaleString()} 삼각형`);
  if (result.rect) {
    // 합치는 도구가 다시 계산하지 않게 아틀라스 사각형을 옆에 적어 둔다
    const note = file.replace(/\.glb$/, ".json");
    await fs.writeFile(note, JSON.stringify(result.rect, null, 2));
    console.log(
      `  아틀라스 사각형  u ${result.rect.u.map((v) => v.toFixed(4)).join("~")} · v ${result.rect.v.map((v) => v.toFixed(4)).join("~")}  → ${path.basename(note)}`,
    );
  }
  if (errors.length) console.log("  ⚠ 페이지 오류:\n   " + errors.join("\n   "));
} finally {
  await browser.close();
}
