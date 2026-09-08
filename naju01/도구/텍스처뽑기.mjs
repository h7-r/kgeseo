// ═══════════════════════════════════════════════════════════════
//  텍스처뽑기.mjs — Meshy 가 돌려준 GLB 에서 **텍스처만** 꺼낸다
// ═══════════════════════════════════════════════════════════════
// 쓰는 법  node naju01/도구/텍스처뽑기.mjs <받은.glb>
//
// [왜 기하를 안 쓰고 텍스처만 꺼내나]
//   Meshy 는 모델을 **단위 상자로 정규화**해서 돌려준다(우리 건 133.3333 배로
//   줄여서 왔다). 정점도 용접해서 278,730 개가 100,199 개로 합쳐졌다.
//   그 메시를 그대로 씬에 넣으면 좌표를 되돌리는 과정에서 **판정과 어긋날 여지**가
//   생긴다 — 이 프로젝트가 가장 오래 싸운 종류의 버그다.
//
//   그런데 확인해 보니 **UV 가 우리가 넘긴 그대로** 돌아왔다
//   (u 0.0064~0.9936 · v 0.0040~0.9726, 소수점까지 일치).
//   UV 가 같으면 **텍스처는 우리 원본 메시에 그대로 맞는다.**
//   그러니 기하는 버리고 그림만 가져오면 된다 — 판정은 한 점도 안 건드린다.
//
// [나오는 것]
//   에셋/지형/바탕색.jpg      baseColor
//   에셋/지형/거칠기금속.jpg   metallicRoughness (G=거칠기, B=금속)
//   에셋/지형/법선.jpg        normal

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const 들어온것 = process.argv[2];
if (!들어온것) {
  console.error("쓰는 법: node naju01/도구/텍스처뽑기.mjs <받은.glb>");
  process.exit(1);
}
const 나갈곳 = path.join(여기, "..", "에셋", "지형");
await fs.mkdir(나갈곳, { recursive: true });

// ── GLB 뜯기 ───────────────────────────────────────────────
const 통 = await fs.readFile(들어온것);
let 커서 = 12;
let 표 = null;
let 살 = null;
while (커서 < 통.length) {
  const 길이 = 통.readUInt32LE(커서);
  const 종류 = 통.readUInt32LE(커서 + 4);
  if (종류 === 0x4e4f534a) 표 = JSON.parse(통.slice(커서 + 8, 커서 + 8 + 길이).toString("utf8"));
  if (종류 === 0x004e4942) 살 = 통.slice(커서 + 8, 커서 + 8 + 길이);
  커서 += 8 + 길이;
}
if (!표) throw new Error("GLB 안에서 JSON 조각을 못 찾았다");

// ── 어떤 그림이 어떤 쓰임인가 ───────────────────────────────
//   재질이 가리키는 슬롯으로 판별한다. 이름에 기대지 않는다
//   (Meshy 가 이름을 안 붙여 줄 수도 있다).
const 재질 = 표.materials?.[0];
const pbr = 재질?.pbrMetallicRoughness ?? {};
const 슬롯 = {
  바탕색: pbr.baseColorTexture?.index,
  거칠기금속: pbr.metallicRoughnessTexture?.index,
  법선: 재질?.normalTexture?.index,
};

// PNG/JPEG 머리에서 가로세로를 읽는다(라이브러리 없이)
function 크기재기(buf) {
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
for (const [쓰임, 텍번호] of Object.entries(슬롯)) {
  if (텍번호 === undefined) { console.log(`  ${쓰임}: 없음`); continue; }
  const 그림번호 = 표.textures[텍번호].source;
  const 그림 = 표.images[그림번호];
  const bv = 표.bufferViews[그림.bufferView];
  const 자료 = 살.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const 확장 = 그림.mimeType === "image/png" ? "png" : "jpg";
  const 파일 = path.join(나갈곳, `${쓰임}.${확장}`);
  await fs.writeFile(파일, 자료);
  const [w, h] = 크기재기(자료);
  console.log(
    `  ${쓰임.padEnd(6)} ${w}×${h}  ${(자료.length / 1048576).toFixed(2)} MB  → 에셋/지형/${쓰임}.${확장}`,
  );
}
