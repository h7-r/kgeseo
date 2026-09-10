// ═══════════════════════════════════════════════════════════════
//  모형굽기.mjs — Meshy 에서 받은 GLB 를 표본 모듈로 굽는다
// ═══════════════════════════════════════════════════════════════
//  쓰는 법:  node 도구/모형굽기.mjs 에셋/모형/구렁이.glb src/모형/구렁이.js 구렁이모형
//
// [왜 실행 중에 안 불러오고 미리 굽나]
//   이 그레이박스의 표본(prototype)은 전부 **동기 함수**다. `공간그레이박스`
//   가 첫 프레임에 `표본` 을 한꺼번에 만들고, `미리보기.js` 는 그걸 그대로
//   받아 팔레트 썸네일을 **그 자리에서** 굽는다. 여기에 비동기 로더를 끼우면
//   ─ 무리는 한 박자 늦게 서고, ─ 썸네일은 아직 없는 표본을 보고 비어 버린다.
//   그래서 GLB 는 **작업물**로 두고, 굽는 일은 여기서 미리 해 둔다.
//   모형을 다시 뽑았으면 이 명령 한 줄을 다시 돌리면 된다.
//
// [무엇을 하나]
//   1. GLB 의 첫 메시에서 위치·인덱스를 꺼낸다 (Meshy 생성 단계 출력은
//      재질·노멀·UV 가 없다 — 위치뿐이다).
//   2. **밑동이 원점**, XZ 한복판, **Z 폭 1** 로 맞춘다.
//      씬1.js 의 `길이1로` 와 같은 규약이라, 놓는 쪽 코드가 안 바뀐다.
//   3. Float32 / Uint16 을 base64 로 적어 낸다. 텍스트로 풀어 쓰면 파일이
//      네 배로 붇고 diff 도 못 읽는다.
//   ※ 노멀·꼭짓점 색은 굽지 않는다 — 불러오는 쪽에서 `computeVertexNormals`
//     로 만들고 흰색을 깔아 준다(색은 `instanceColor` 가 곱한다).

import fs from "node:fs";
import path from "node:path";

const [입력, 출력, 이름 = "모형", 축 = "auto"] = process.argv.slice(2);
if (!입력 || !출력) {
  console.error(
    "쓰는 법: node 도구/모형굽기.mjs <입력.glb> <출력.js> [이름] [축]\n" +
      "  축: auto(기본) | keep\n" +
      "      auto — 가로로 가장 긴 쪽이 **Z** 가 되도록 Y 축으로 90° 돌린다",
  );
  process.exit(1);
}

// ── GLB 를 연다 ────────────────────────────────────────────
const 바 = fs.readFileSync(입력);
if (바.readUInt32LE(0) !== 0x46546c67) throw new Error("glTF 이진(GLB) 파일이 아니다");
const JSON길이 = 바.readUInt32LE(12);
const 문서 = JSON.parse(바.slice(20, 20 + JSON길이).toString("utf8"));
// JSON 청크 뒤에 BIN 청크가 온다 (8 바이트 머리말)
const BIN시작 = 20 + JSON길이 + 8;

const 조각내기 = (번호) => {
  const 접근 = 문서.accessors[번호];
  const 뷰 = 문서.bufferViews[접근.bufferView];
  const 자리 = BIN시작 + (뷰.byteOffset ?? 0) + (접근.byteOffset ?? 0);
  const 칸 = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[접근.type];
  const 형 = {
    5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
  }[접근.componentType];
  if (!형) throw new Error(`모르는 componentType ${접근.componentType}`);
  // slice() 로 복사한다 — subarray 면 정렬이 안 맞아 터진다
  return new 형(바.buffer.slice(바.byteOffset + 자리, 바.byteOffset + 자리 + 접근.count * 칸 * 형.BYTES_PER_ELEMENT));
};

const 프림 = 문서.meshes[0].primitives[0];
const 위치 = 조각내기(프림.attributes.POSITION);
const 인덱스원 = 조각내기(프림.indices);
const 꼭 = 위치.length / 3;
if (꼭 > 65535) throw new Error(`꼭짓점이 ${꼭} 개다 — 먼저 줄여라 (gltf-transform simplify)`);

// ── 긴 쪽을 Z 로 돌린다 ────────────────────────────────────
// [왜 필요한가]
//   Meshy 는 물건을 아무 방향으로나 내놓는다. 배 모형은 **X 축으로 누워**
//   있었다(1.898 × 0.566 × 0.862). 그런데 이 프로젝트의 「누운 물건」 규약은
//   **길이 = Z** 다(나루터·가로대·상판이 전부 그렇다). 그대로 구우면
//   배가 옆으로 누운 채 길이만 폭에 들어가서, `키` 에 4.4 m 를 줘도
//   **4.4 m 폭짜리 배**가 된다.
//   그래서 가로(X·Z) 중 긴 쪽이 Z 가 되도록 Y 축으로 90° 돌린다.
{
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 꼭; i++)
    for (let c = 0; c < 3; c++) {
      const v = 위치[i * 3 + c];
      if (v < mn[c]) mn[c] = v;
      if (v > mx[c]) mx[c] = v;
    }
  const 가로 = mx[0] - mn[0];
  const 세로 = mx[2] - mn[2];
  if (축 === "auto" && 가로 > 세로) {
    // (x, z) → (z, -x) : Y 축 −90°
    for (let i = 0; i < 꼭; i++) {
      const x = 위치[i * 3];
      const z = 위치[i * 3 + 2];
      위치[i * 3] = z;
      위치[i * 3 + 2] = -x;
    }
    console.log(`  가로(${가로.toFixed(3)})가 세로(${세로.toFixed(3)})보다 길어 Y 축으로 90° 돌렸다`);
  }
}

// ── 밑동 원점 · XZ 한복판 · Z 폭 1 ─────────────────────────
let 최소 = [Infinity, Infinity, Infinity];
let 최대 = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < 꼭; i++)
  for (let c = 0; c < 3; c++) {
    const v = 위치[i * 3 + c];
    if (v < 최소[c]) 최소[c] = v;
    if (v > 최대[c]) 최대[c] = v;
  }
const 폭 = [0, 1, 2].map((c) => 최대[c] - 최소[c]);
const 배율 = 1 / (폭[2] || 1);
const 옮김 = [
  -(최소[0] + 폭[0] / 2), // X 한복판
  -최소[1], //               밑동을 y=0 으로
  -(최소[2] + 폭[2] / 2), // Z 한복판
];
const 맞춘것 = new Float32Array(꼭 * 3);
for (let i = 0; i < 꼭; i++)
  for (let c = 0; c < 3; c++) 맞춘것[i * 3 + c] = (위치[i * 3 + c] + 옮김[c]) * 배율;

const 인덱스 = Uint16Array.from(인덱스원);

// ── 적어 낸다 ──────────────────────────────────────────────
const b64 = (형배열) => Buffer.from(형배열.buffer, 형배열.byteOffset, 형배열.byteLength).toString("base64");
const 실폭 = 폭.map((v) => (v * 배율).toFixed(4));
const 글 = `// ═══════════════════════════════════════════════════════════════
//  ${이름} — Meshy 모형을 구운 것 (**손으로 고치지 않는다**)
// ═══════════════════════════════════════════════════════════════
//  원본:  ${path.basename(입력)}
//  삼각형 ${인덱스.length / 3} · 꼭짓점 ${꼭}
//  맞춰 둔 것: 밑동 y=0 · XZ 한복판 · **Z 폭 1** (씬1.js \`길이1로\` 와 같은 규약)
//  다시 구우려면:  node 도구/모형굽기.mjs ${입력} ${출력} ${이름}
//
//  ※ 노멀·꼭짓점 색은 여기 없다. 불러오는 쪽이 \`computeVertexNormals\` 로
//    만들고 흰색을 깐다 — 실제 색은 \`instanceColor\` 가 곱한다.

export const ${이름} = {
  // Z 폭을 1 로 맞췄을 때의 세 폭 — 놓는 쪽이 \`키\` 를 정할 때 본다
  폭: { x: ${실폭[0]}, y: ${실폭[1]}, z: ${실폭[2]} },
  꼭짓점: ${꼭},
  삼각형: ${인덱스.length / 3},
  위치: "${b64(맞춘것)}",
  인덱스: "${b64(인덱스)}",
};
`;
fs.mkdirSync(path.dirname(출력), { recursive: true });
fs.writeFileSync(출력, 글, "utf8");
console.log(
  `  ${path.basename(입력)} → ${출력}\n` +
    `  삼각형 ${인덱스.length / 3} · 꼭짓점 ${꼭} · ${(글.length / 1024) | 0} KB\n` +
    `  Z 폭 1 기준 세 폭 — x ${실폭[0]} · y ${실폭[1]} · z ${실폭[2]}`,
);
