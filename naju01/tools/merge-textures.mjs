// merge-textures.mjs — 칸별로 따로 구운 텍스처를 아틀라스 한 장으로 합친다.
// 쓰는 법
//   node naju01/tools/merge-textures.mjs --auto
//   node naju01/tools/merge-textures.mjs ground=<받은바닥.glb> cliff=<받은절벽.glb> [Z1=<glb> ...]
// 나오는 것  assets/terrain/{base-color,roughness-metalness,normal}.jpg — 기존 자리에 덮어쓴다
//
// Meshy 는 한 모델에 재질 하나만 입혀 절벽과 땅을 한 덩이로 넘기면 같은 회색으로 뭉갰다.
// 칸별로 굽고 사각형만 오려 붙이면 결과는 여전히 한 장 · 한 재질 · 드로우콜 하나라 이음매가 없다.

// Meshy 가 8K 로 줄 때가 있는데 8192² PBR 은 장당 GPU 268 MB 라 4K 로 자른다(바닥 51 px/m, 절벽 98 px/m 면 충분)
const MAX_RESOLUTION = 4096;

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "assets", "terrain");
const sourceDir = path.join(here, "..", "assets", "source");
const url = process.env.NAJU_URL ?? "http://localhost:5174/?bloom=off";

// terrainAtlas.ts 의 ATLAS_LAYOUT 과 같은 값이어야 한다.
// 구역(Z1~Z4)은 여기 안 적고 내보낼 때 GLB 옆에 적은 .json 을 읽는다 — 두 곳에 적으면 언젠가 어긋난다
const LAYOUT = {
  ground: { u: [0, 1], v: [0, 0.625] },
  cliff: { u: [0, 0.56], v: [0.63, 1] },
};

// 덮는 순서 — 바닥(전체)을 깔고, 절벽, 그 위에 구역들
const ORDER = ["ground", "cliff", "Z1", "Z2", "Z3", "Z4"];

// GLB 의 삼각형 수만 읽는다(자동 분류용 — 파일 이름은 안 믿는다)
async function triangleCount(file) {
  const glb = await fs.readFile(file);
  let cursor = 12, json = null;
  while (cursor < glb.length) {
    const length = glb.readUInt32LE(cursor);
    const type = glb.readUInt32LE(cursor + 4);
    if (type === 0x4e4f534a) {
      json = JSON.parse(glb.slice(cursor + 8, cursor + 8 + length).toString("utf8"));
      break;
    }
    cursor += 8 + length;
  }
  const pr = json?.meshes?.[0]?.primitives?.[0];
  if (!pr) return 0;
  const n =
    pr.indices !== undefined
      ? json.accessors[pr.indices].count
      : json.accessors[pr.attributes.POSITION].count;
  return Math.round(n / 3);
}

const inputs = {};
const args = process.argv.slice(2);
const auto = args.includes("--auto");

if (auto) {
  // Meshy 가 돌려주는 파일 이름은 잘리고 뒤섞인다. 리텍스처는 삼각형을 안 바꾸므로 내보낸 GLB 와 삼각형 수로 짝짓는다
  const byCount = {};
  for (const name of ORDER) {
    const f = path.join(sourceDir, `terrain-${name}-underpaint.glb`);
    try {
      byCount[await triangleCount(f)] = name;
    } catch {
      /* 안 뽑아 둔 것은 건너뛴다 */
    }
  }
  const files = (await fs.readdir(sourceDir))
    .filter((f) => f.endsWith(".glb") && !f.startsWith("terrain-"))
    .map((f) => path.join(sourceDir, f));
  console.log("── 자동 분류 (삼각형 수 대조) ──────────");
  for (const f of files) {
    const n = await triangleCount(f);
    const name = byCount[n];
    if (!name) {
      console.log(`  ? ${path.basename(f)}  삼각 ${n.toLocaleString()} — 짝을 못 찾음`);
      continue;
    }
    // 같은 칸이 여럿이면 최신 파일을 쓴다
    const previous = inputs[name];
    if (previous) {
      const [a, b2] = await Promise.all([fs.stat(previous), fs.stat(f)]);
      if (a.mtimeMs >= b2.mtimeMs) {
        console.log(`  · ${path.basename(f)}  → ${name} (더 오래됨, 건너뜀)`);
        continue;
      }
    }
    inputs[name] = f;
    console.log(`  ✔ ${path.basename(f)}  삼각 ${n.toLocaleString()} → ${name}`);
  }
} else {
  for (const arg of args) {
    const i = arg.indexOf("=");
    if (i < 0) continue;
    const name = arg.slice(0, i);
    const file = arg.slice(i + 1);
    if (ORDER.includes(name) && file) inputs[name] = file;
  }
}
if (!Object.keys(inputs).length) {
  console.error(
    "쓰는 법: node naju01/tools/merge-textures.mjs --auto\n" +
      "     또는 node naju01/tools/merge-textures.mjs ground=<glb> cliff=<glb> [Z1=<glb> ...]",
  );
  process.exit(1);
}

// 이름 → 아틀라스 사각형. 구역은 GLB 옆 .json 에서 읽는다
async function findRect(name, file) {
  if (LAYOUT[name]) return LAYOUT[name];
  const readNote = async (note) => JSON.parse(await fs.readFile(note, "utf8"));
  try {
    return await readNote(file.replace(/\.glb$/, ".json"));
  } catch {
    // 받은 파일 이름이 Meshy 것으로 바뀌었어도 내보낸 원본 쪽지를 찾아본다
    return readNote(path.join(path.dirname(file), `terrain-${name}-underpaint.json`));
  }
}

// GLB 에서 그림 세 장 꺼내기(extract-textures.mjs 와 같은 규칙).
// 숫자 배열로 넘기면 4K JPEG 한 장(11 MB)에 노드 힙이 터졌다 — base64 로, 맵 한 종류씩 처리한다
async function readImages(file) {
  const glb = await fs.readFile(file);
  let cursor = 12, json = null, bin = null;
  while (cursor < glb.length) {
    const length = glb.readUInt32LE(cursor);
    const type = glb.readUInt32LE(cursor + 4);
    if (type === 0x4e4f534a) json = JSON.parse(glb.slice(cursor + 8, cursor + 8 + length).toString("utf8"));
    if (type === 0x004e4942) bin = glb.slice(cursor + 8, cursor + 8 + length);
    cursor += 8 + length;
  }
  const material = json.materials?.[0];
  const pbr = material?.pbrMetallicRoughness ?? {};
  const slots = {
    "base-color": pbr.baseColorTexture?.index,
    "roughness-metalness": pbr.metallicRoughnessTexture?.index,
    normal: material?.normalTexture?.index,
  };
  const result = {};
  for (const [usage, i] of Object.entries(slots)) {
    if (i === undefined) continue;
    const image = json.images[json.textures[i].source];
    const bv = json.bufferViews[image.bufferView];
    result[usage] = {
      data: bin
        .slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)
        .toString("base64"),
      mimeType: image.mimeType,
    };
  }
  return result;
}

const images = {};
const rects = {};
for (const name of ORDER) {
  if (!inputs[name]) continue;
  images[name] = await readImages(inputs[name]);
  rects[name] = await findRect(name, inputs[name]);
  const r = rects[name];
  console.log(
    `  ${name.padEnd(4)} ← ${path.basename(inputs[name])}` +
      `  (u ${r.u[0].toFixed(3)}~${r.u[1].toFixed(3)} · v ${r.v[0].toFixed(3)}~${r.v[1].toFixed(3)})`,
  );
}

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });

try {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 30000 });

  console.log("── 합침 ────────────────────────────────");
  for (const usage of ["base-color", "roughness-metalness", "normal"]) {
    const pieces = {};
    for (const cell of Object.keys(images)) if (images[cell][usage]) pieces[cell] = images[cell][usage];
    if (!Object.keys(pieces).length) continue;

    const merged = await page.evaluate(
      async ([pieces, layout, usage, maxSize, order]) => {
        const load = (b64, mimeType) =>
          new Promise((ok, no) => {
            const im = new Image();
            im.onload = () => ok(im);
            im.onerror = no;
            im.src = `data:${mimeType};base64,${b64}`;
          });
        const loaded = {};
        let size = 0;
        for (const k of Object.keys(pieces)) {
          loaded[k] = await load(pieces[k].data, pieces[k].mimeType);
          size = Math.max(size, loaded[k].width);
        }
        size = Math.min(size, maxSize);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        // 법선의 빈 칸은 '평평함'(128,128,255), 나머지는 중간 흙색
        ctx.fillStyle = usage === "normal" ? "rgb(128,128,255)" : "rgb(138,124,99)";
        ctx.fillRect(0, 0, size, size);
        // 바닥(전체) → 절벽 → 구역들 순서로 덮는다
        for (const k of order) {
          if (!loaded[k]) continue;
          const r = layout[k];
          // fill = 돌아온 그림 전체가 이 사각형이다(구역 UV 를 0~1 로 펴서 넘겼다)
          const sx = r.fill ? 0 : r.u[0] * loaded[k].width;
          const sy = r.fill ? 0 : r.v[0] * loaded[k].height;
          const sw = r.fill ? loaded[k].width : (r.u[1] - r.u[0]) * loaded[k].width;
          const sh = r.fill ? loaded[k].height : (r.v[1] - r.v[0]) * loaded[k].height;
          ctx.drawImage(
            loaded[k], sx, sy, sw, sh,
            r.u[0] * size, r.v[0] * size,
            (r.u[1] - r.u[0]) * size, (r.v[1] - r.v[0]) * size,
          );
        }
        return { data: canvas.toDataURL("image/jpeg", 0.92).split(",")[1], size };
      },
      [pieces, rects, usage, MAX_RESOLUTION, ORDER],
    );

    const file = path.join(outDir, `${usage}.jpg`);
    const data = Buffer.from(merged.data, "base64");
    await fs.writeFile(file, data);
    console.log(
      `  ${usage.padEnd(6)} ${merged.size}² · ${(data.length / 1048576).toFixed(2)} MB → assets/terrain/${usage}.jpg`,
    );
  }
} finally {
  await browser.close();
}
