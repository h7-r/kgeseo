// Meshy 가 돌려준 GLB 에서 텍스처만 꺼낸다.
// 쓰는 법  node naju01/tools/extract-textures.mjs <받은.glb>
// 나오는 것  assets/terrain/base-color.jpg(baseColor) · roughness-metalness.jpg(G=거칠기, B=금속) · normal.jpg
//
// 기하는 버린다: Meshy 는 단위 상자로 정규화하고 정점을 용접해 돌려줘 판정과 어긋날 수 있다.
// UV 는 넘긴 그대로 돌아오므로 그림만 우리 메시에 입히면 판정은 한 점도 안 건드린다.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readGlbChunks, readMaterialTextures, TEXTURE_USAGES } from "./glb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
if (!input) {
  console.error("쓰는 법: node naju01/tools/extract-textures.mjs <받은.glb>");
  process.exit(1);
}
const outDir = path.join(here, "..", "assets", "terrain");
await fs.mkdir(outDir, { recursive: true });

const { json, bin } = readGlbChunks(await fs.readFile(input));
if (!json) throw new Error("GLB 안에서 JSON 조각을 못 찾았다");
const textures = readMaterialTextures(json, bin);

// PNG/JPEG 머리에서 가로세로를 읽는다(라이브러리 없이)
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; // PNG
  let i = 2; // JPEG
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF 표지(DHT·JPG·DAC 제외)에 높이·너비가 있다
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [0, 0];
}

console.log("── 텍스처 뽑기 ─────────────────────────");
for (const usage of TEXTURE_USAGES) {
  const texture = textures[usage];
  if (!texture) {
    console.log(`  ${usage}: 없음`);
    continue;
  }
  const ext = texture.mimeType === "image/png" ? "png" : "jpg";
  await fs.writeFile(path.join(outDir, `${usage}.${ext}`), texture.data);
  const [width, height] = imageSize(texture.data);
  console.log(
    `  ${usage.padEnd(6)} ${width}×${height}  ${(texture.data.length / 1048576).toFixed(2)} MB  → assets/terrain/${usage}.${ext}`,
  );
}
