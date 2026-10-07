// extract-textures.mjs — Meshy 가 돌려준 GLB 에서 텍스처만 꺼낸다.
// 쓰는 법  node naju01/tools/extract-textures.mjs <받은.glb>
// 나오는 것  assets/terrain/base-color.jpg(baseColor) · roughness-metalness.jpg(G=거칠기, B=금속) · normal.jpg
//
// 기하를 버리는 이유: Meshy 는 단위 상자로 정규화하고(133.3333 배 축소) 정점을 용접해 돌려줘 판정과 어긋날 여지가 생긴다.
// UV 는 넘긴 그대로 돌아오므로(소수점까지 일치) 그림만 원본 메시에 입히면 판정은 한 점도 안 건드린다.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
if (!input) {
  console.error("쓰는 법: node naju01/tools/extract-textures.mjs <받은.glb>");
  process.exit(1);
}
const outDir = path.join(here, "..", "assets", "terrain");
await fs.mkdir(outDir, { recursive: true });

// GLB 뜯기
const glb = await fs.readFile(input);
let cursor = 12;
let json = null;
let bin = null;
while (cursor < glb.length) {
  const length = glb.readUInt32LE(cursor);
  const type = glb.readUInt32LE(cursor + 4);
  if (type === 0x4e4f534a) json = JSON.parse(glb.slice(cursor + 8, cursor + 8 + length).toString("utf8"));
  if (type === 0x004e4942) bin = glb.slice(cursor + 8, cursor + 8 + length);
  cursor += 8 + length;
}
if (!json) throw new Error("GLB 안에서 JSON 조각을 못 찾았다");

// 재질 슬롯으로 쓰임을 판별한다 — Meshy 가 이름을 안 붙여 줄 수도 있다
const material = json.materials?.[0];
const pbr = material?.pbrMetallicRoughness ?? {};
const slots = {
  "base-color": pbr.baseColorTexture?.index,
  "roughness-metalness": pbr.metallicRoughnessTexture?.index,
  normal: material?.normalTexture?.index,
};

// PNG/JPEG 머리에서 가로세로를 읽는다(라이브러리 없이)
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50)
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; // PNG
  let i = 2; // JPEG
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [0, 0];
}

console.log("── 텍스처 뽑기 ─────────────────────────");
for (const [usage, textureIndex] of Object.entries(slots)) {
  if (textureIndex === undefined) { console.log(`  ${usage}: 없음`); continue; }
  const imageIndex = json.textures[textureIndex].source;
  const image = json.images[imageIndex];
  const bv = json.bufferViews[image.bufferView];
  const data = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const ext = image.mimeType === "image/png" ? "png" : "jpg";
  const file = path.join(outDir, `${usage}.${ext}`);
  await fs.writeFile(file, data);
  const [w, h] = imageSize(data);
  console.log(
    `  ${usage.padEnd(6)} ${w}×${h}  ${(data.length / 1048576).toFixed(2)} MB  → assets/terrain/${usage}.${ext}`,
  );
}
