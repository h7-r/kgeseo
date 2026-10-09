// Meshy 에서 받은 GLB 를 표본 JSON(src/models/baked/<name>.json)으로 굽는다.
//   node tools/bake-model.mjs <input.glb> <name> [rule] [size] [targetTriangles]
//   rule — lying(기본) | height | center
//
// 실행 중에 GLB 를 읽지 않고 미리 굽는 이유: 표본 함수가 전부 동기다. 씬이 첫 프레임에 표본을 한꺼번에 만들고
// 썸네일도 그 자리에서 굽는데, 비동기 로더를 끼우면 무리가 한 박자 늦게 서고 썸네일이 빈다.
// 노멀·꼭짓점 색은 굽지 않는다 — 불러오는 쪽이 computeVertexNormals 로 만들고 색은 instanceColor 가 곱한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boundingBox, compactVertices, normalizeToRule, toBase64, weldVertices } from "./bakedMesh.mjs";
import { readGlbChunks } from "./glb.mjs";

const BAKED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "models", "baked");

const [input, name, rule = "lying", sizeArg, targetArg] = process.argv.slice(2);
if (!input || !name || !["lying", "height", "center"].includes(rule)) {
  console.error(
    "쓰는 법: node tools/bake-model.mjs <input.glb> <name> [rule] [size] [targetTriangles]\n" +
      "  rule — 이 프로젝트의 표본 규약 셋 중 하나다:\n" +
      "    lying(기본)  Z 폭 1 · 밑동 y=0 · XZ 한복판.  `키` = 길이\n" +
      "                 누운 물건 — 나루터 · 가로대 · 나룻배 · 통발 · 구렁이\n" +
      "                 가로로 더 길면 Y 축 90° 돌려 **긴 쪽을 Z 로** 맞춘다\n" +
      "    height       **Y 폭 1** · 밑동 y=0 · XZ 한복판.  `키` = 키(m)\n" +
      "                 선 물건 — 나무 · 덤불 · 풀 · 꽃 · 장승 · 비석\n" +
      "    center       가장 긴 쪽 = size(기본 0.8) · **자리 한복판이 원점**\n" +
      "                 굴러다니는 것 — 바위 · 자갈\n" +
      "                 0.8 은 지금 쓰는 돌 표본의 크기다 — 맞춰야 이미 놓인 돌들의 `키` 가 안 어긋난다.\n" +
      "  targetTriangles — 주면 **용접 + 감면**을 여기서 한다(meshoptimizer).\n" +
      "                    Downloads 의 원본 GLB 를 그대로 넣을 수 있다.\n" +
      "                    안 주면 안 줄인다(이미 줄여 둔 GLB 를 넣을 때).",
  );
  process.exit(1);
}
// Number("") 는 0 이다 — 크기를 건너뛰려고 "" 를 넘기면 center 배율이 0 이 되어 모형이 한 점으로 찌그러진다
const size = sizeArg === undefined || sizeArg === "" ? 0.8 : Number(sizeArg);
if (!Number.isFinite(size) || size <= 0) {
  console.error(`크기가 이상하다: ${JSON.stringify(sizeArg)} → ${size}`);
  process.exit(1);
}
const targetTriangles = Number(targetArg ?? 0);

// GLB 를 연다
const file = fs.readFileSync(input);
if (file.readUInt32LE(0) !== 0x46546c67) throw new Error("glTF 이진(GLB) 파일이 아니다");
const { json: gltf, bin } = readGlbChunks(file);

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAY_TYPES = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const readAccessor = (index) => {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type];
  const ArrayType = ARRAY_TYPES[accessor.componentType];
  if (!ArrayType) throw new Error(`모르는 componentType ${accessor.componentType}`);
  // slice() 로 복사한다 — subarray 면 정렬이 안 맞아 터진다
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new ArrayType(bin.buffer.slice(start, start + accessor.count * components * ArrayType.BYTES_PER_ELEMENT));
};

const primitive = gltf.meshes[0].primitives[0];
let positions = readAccessor(primitive.attributes.POSITION);
let indices =
  primitive.indices !== undefined
    ? readAccessor(primitive.indices)
    : // 인덱스가 없는 Meshy 생성본도 있다
      Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
const sourceTriangles = indices.length / 3;

// 용접 + 감면. 인덱스를 Uint16 으로 적으므로 꼭짓점 65,535 개가 천장이다.
if (targetTriangles > 0 && indices.length / 3 > targetTriangles) {
  const { MeshoptSimplifier } = await import("meshoptimizer");
  await MeshoptSimplifier.ready;
  const welded = weldVertices(positions, indices);
  console.log(
    `  용접   꼭짓점 ${(positions.length / 3).toLocaleString()} → ${(welded.positions.length / 3).toLocaleString()}`,
  );

  const [simplified, error] = MeshoptSimplifier.simplify(
    welded.indices,
    welded.positions,
    3,
    targetTriangles * 3,
    0.05, // 허용 오차 — 넘기면 목표보다 덜 줄인다(형태를 지킨다)
    ["LockBorder"],
  );
  ({ positions, indices } = compactVertices(simplified, welded.positions));
  console.log(
    `  감면   삼각형 ${(welded.indices.length / 3).toLocaleString()} → ${(indices.length / 3).toLocaleString()}` +
      ` · 꼭짓점 ${(positions.length / 3).toLocaleString()} · 오차 ${error.toFixed(4)}`,
  );
}

const vertexCount = positions.length / 3;
if (vertexCount > 65535)
  throw new Error(
    `꼭짓점이 ${vertexCount} 개다 — 인덱스를 Uint16 으로 적으므로 65,535 가 천장이다.\n` +
      `  목표 삼각형을 낮춰라: node tools/bake-model.mjs <input.glb> <name> [rule] [size] [targetTriangles]`,
  );

// 긴 쪽을 Z 로 돌린다. Meshy 는 물건을 아무 방향으로나 내놓는데 누운 물건 규약은 길이 = Z 라,
// 그대로 구우면 `키` 4.4 m 를 줘도 4.4 m 폭짜리 배가 된다.
{
  const { min, max } = boundingBox(positions);
  const widthX = max[0] - min[0];
  const depthZ = max[2] - min[2];
  if (rule === "lying" && widthX > depthZ) {
    // (x, z) → (z, -x) : Y 축 −90°
    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3];
      const z = positions[i * 3 + 2];
      positions[i * 3] = z;
      positions[i * 3 + 2] = -x;
    }
    console.log(`  가로(${widthX.toFixed(3)})가 세로(${depthZ.toFixed(3)})보다 길어 Y 축으로 90° 돌렸다`);
  }
}

const normalized = normalizeToRule(positions, rule, size);
const indices16 = Uint16Array.from(indices);

// 적어 낸다
const { x: sizeX, y: sizeY, z: sizeZ } = normalized.size;
const triangleCount = indices16.length / 3;
const model = {
  name,
  source: path.basename(input),
  rule,
  ...(rule === "center" ? { centerSize: size } : {}),
  bakeCommand: `node tools/bake-model.mjs ${input} ${name} ${rule}`,
  ...(triangleCount < sourceTriangles ? { decimatedFrom: sourceTriangles } : {}),
  size: { x: sizeX, y: sizeY, z: sizeZ },
  vertexCount,
  triangleCount,
  positions: toBase64(normalized.positions),
  indices: toBase64(indices16),
};
const output = path.join(BAKED_DIR, `${name}.json`);
const text = JSON.stringify(model, null, 2) + "\n";
fs.mkdirSync(BAKED_DIR, { recursive: true });
fs.writeFileSync(output, text, "utf8");
console.log(
  `  ${path.basename(input)} → ${path.relative(process.cwd(), output)}\n` +
    `  삼각형 ${triangleCount} · 꼭짓점 ${vertexCount} · ${(text.length / 1024) | 0} KB\n` +
    `  규약 폭 — x ${sizeX} · y ${sizeY} · z ${sizeZ}\n` +
    `  새 모형이면 src/models/baked/index.ts 에 한 줄 더한다`,
);
