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

const [입력, 출력, 이름 = "모형", 규약 = "눕힘", 크기옵션, 목표옵션] =
  process.argv.slice(2);
if (!입력 || !출력) {
  console.error(
    "쓰는 법: node 도구/모형굽기.mjs <입력.glb> <출력.js> [이름] [규약] [크기]\n" +
      "  규약 — 이 프로젝트의 표본 규약 셋 중 하나다(실측으로 확인한 것):\n" +
      "    눕힘(기본)  Z 폭 1 · 밑동 y=0 · XZ 한복판.  `키` = 길이\n" +
      "                누운 물건 — 나루터 · 가로대 · 나룻배 · 통발 · 구렁이\n" +
      "                ※ 가로로 더 길면 Y 축 90° 돌려 **긴 쪽을 Z 로** 맞춘다\n" +
      "    높이        **Y 폭 1** · 밑동 y=0 · XZ 한복판.  `키` = 키(m)\n" +
      "                선 물건 — 나무 · 덤불 · 풀 · 꽃 · 장승 · 비석\n" +
      "    중심        가장 긴 쪽 = `크기`(기본 0.8) · **자리 한복판이 원점**\n" +
      "                굴러다니는 것 — 바위 · 자갈\n" +
      "                0.8 인 이유: 지금 쓰는 `돌표본들` 을 재 보니 그렇다.\n" +
      "                맞춰 두어야 이미 놓인 돌들의 `키` 가 안 어긋난다.\n" +
      "  목표삼각형 — 주면 **용접 + 감면**을 여기서 한다(meshoptimizer).\n" +
      "               Downloads 의 원본 GLB 를 그대로 넣을 수 있다.\n" +
      "               안 주면 안 줄인다(이미 줄여 둔 GLB 를 넣는 옛 쓰임새).",
  );
  process.exit(1);
}
const 크기 = Number(크기옵션 ?? 0.8);
// 목표 삼각형 — 안 주면 감면하지 않는다(이미 줄여 둔 GLB 를 넣는 옛 쓰임새).
const 목표삼각형 = Number(목표옵션 ?? 0);

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
let 위치 = 조각내기(프림.attributes.POSITION);
let 인덱스원 =
  프림.indices !== undefined
    ? 조각내기(프림.indices)
    : // 인덱스가 없는 GLB 도 있다(Meshy 생성본 일부). 0,1,2,… 로 만들어 준다.
      Uint32Array.from({ length: 위치.length / 3 }, (_, i) => i);

// ── 용접 + 감면 ────────────────────────────────────────────
// [왜 여기서 하나]
//   예전에는 `gltf-transform` CLI 로 미리 줄여 `에셋/모형/*.glb` 를 만들고
//   이 도구는 그걸 받기만 했다. 그래서 「조금만 더 살려 보자」를 해 보려면
//   **도구 두 개를 오가야** 했고, 얼마나 줄였는지도 파일에 안 남았다.
//   `meshoptimizer` 가 이미 node_modules 에 있으니 여기서 한 번에 한다.
//   → 이제 **Downloads 의 원본 GLB 를 그대로** 넣고 목표 삼각형만 주면 된다.
//
// [왜 용접이 먼저인가]
//   Meshy 생성본은 꼭짓점을 **안 합쳐서** 낸다(초가집1: 삼각형 306만에
//   꼭짓점 153만). 용접 없이 감면하면 같은 자리 꼭짓점이 따로 놀아
//   면이 조각조각 떨어진다.
//
// [왜 Uint16 상한이 있나]
//   구운 모듈은 인덱스를 **Uint16** 으로 적는다(파일 크기). 그래서
//   꼭짓점 65,535 개가 천장이다. 목표를 그보다 크게 줘도 여기서 잘린다.
if (목표삼각형 > 0 && 인덱스원.length / 3 > 목표삼각형) {
  const { MeshoptSimplifier } = await import("meshoptimizer");
  await MeshoptSimplifier.ready;
  // ① 용접 — 같은 자리 꼭짓점을 합친다
  const 남은자리 = new Uint32Array(위치.length / 3);
  const 남은수 = MeshoptSimplifier.compactMesh
    ? 0
    : 0; // (compactMesh 는 버전에 따라 없다 — 아래 수동 용접을 쓴다)
  void 남은자리;
  void 남은수;
  const 열쇠 = new Map();
  const 새위치 = [];
  const 옮김 = new Uint32Array(위치.length / 3);
  for (let i = 0; i < 위치.length / 3; i++) {
    // 소수점 5자리(0.01 mm)에서 같으면 같은 점으로 본다
    const k =
      위치[i * 3].toFixed(5) + "," + 위치[i * 3 + 1].toFixed(5) + "," + 위치[i * 3 + 2].toFixed(5);
    let j = 열쇠.get(k);
    if (j === undefined) {
      j = 새위치.length / 3;
      열쇠.set(k, j);
      새위치.push(위치[i * 3], 위치[i * 3 + 1], 위치[i * 3 + 2]);
    }
    옮김[i] = j;
  }
  const 용접위치 = new Float32Array(새위치);
  const 용접인덱스 = new Uint32Array(인덱스원.length);
  for (let i = 0; i < 인덱스원.length; i++) 용접인덱스[i] = 옮김[인덱스원[i]];
  console.log(
    `  용접   꼭짓점 ${(위치.length / 3).toLocaleString()} → ${(용접위치.length / 3).toLocaleString()}`,
  );

  // ② 감면 — 목표 삼각형까지 줄인다
  const 목표인덱스수 = 목표삼각형 * 3;
  const [줄인인덱스, 오차] = MeshoptSimplifier.simplify(
    용접인덱스,
    용접위치,
    3,
    목표인덱스수,
    0.05, // 허용 오차 — 넘기면 목표보다 덜 줄인다(형태를 지킨다)
    ["LockBorder"],
  );
  // ③ 안 쓰는 꼭짓점 버리기
  const 쓴것 = new Map();
  const 짐위치 = [];
  const 짐인덱스 = new Uint32Array(줄인인덱스.length);
  for (let i = 0; i < 줄인인덱스.length; i++) {
    const v = 줄인인덱스[i];
    let j = 쓴것.get(v);
    if (j === undefined) {
      j = 짐위치.length / 3;
      쓴것.set(v, j);
      짐위치.push(용접위치[v * 3], 용접위치[v * 3 + 1], 용접위치[v * 3 + 2]);
    }
    짐인덱스[i] = j;
  }
  위치 = new Float32Array(짐위치);
  인덱스원 = 짐인덱스;
  console.log(
    `  감면   삼각형 ${(용접인덱스.length / 3).toLocaleString()} → ${(인덱스원.length / 3).toLocaleString()}` +
      ` · 꼭짓점 ${(위치.length / 3).toLocaleString()} · 오차 ${오차.toFixed(4)}`,
  );
}

const 꼭 = 위치.length / 3;
if (꼭 > 65535)
  throw new Error(
    `꼭짓점이 ${꼭} 개다 — 인덱스를 Uint16 으로 적으므로 65,535 가 천장이다.\n` +
      `  목표 삼각형을 낮춰라: node 도구/모형굽기.mjs <입력> <출력> [이름] [규약] [크기] [목표삼각형]`,
  );

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
  if (규약 === "눕힘" && 가로 > 세로) {
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
// 규약마다 **무엇을 1 로 볼지**가 다르다 — 위 쓰는 법 참고
const 배율 =
  규약 === "높이"
    ? 1 / (폭[1] || 1)
    : 규약 === "중심"
      ? 크기 / (Math.max(폭[0], 폭[1], 폭[2]) || 1)
      : 1 / (폭[2] || 1);
const 옮김 =
  규약 === "중심"
    ? [
        -(최소[0] + 폭[0] / 2),
        -(최소[1] + 폭[1] / 2), // 위아래도 한복판 — 굴러다니는 것이라 밑동이 없다
        -(최소[2] + 폭[2] / 2),
      ]
    : [
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
//  규약: **${규약}** ${규약 === "높이" ? "(Y 폭 1 · 밑동 원점)" : 규약 === "중심" ? `(가장 긴 쪽 ${크기} · 한복판 원점)` : "(Z 폭 1 · 밑동 원점)"}
//  다시 구우려면:  node 도구/모형굽기.mjs ${입력} ${출력} ${이름} ${규약}
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
