// ═══════════════════════════════════════════════════════════════
//  아틀라스.js — 지형 한 덩이를 'Meshy 에 넘길 수 있는 몸'으로 만드는 곳
// ═══════════════════════════════════════════════════════════════
// [왜 필요한가]
//   Meshy 는 남의 메시에 재질을 입혀 줍니다(리텍스처). 그런데 UV 가 없으면
//   Meshy 가 UV 를 새로 풉니다 — 그 언랩 기능이 **삼각형 4만 면 이하**만
//   받습니다. 우리 지형은 92,910 삼각형이라 그대로는 거부됩니다.
//
//   해결책은 「우리가 UV 를 얹어서 넘기고 `enable_original_uv` 를 켜는 것」입니다.
//   언랩 단계를 아예 안 타므로 4만 면 제한도 안 걸립니다.
//   남의 메시였으면 못 할 일인데, **우리가 지형을 코드로 만들고 있어서**
//   어느 면이 땅이고 어느 면이 절벽인지 이미 알고 있으므로 가능합니다.
//
// [왜 한 덩이로 굽는가]
//   절벽·비탈길·그걸 품은 언덕은 눈에 **하나의 지형**입니다.
//   따로 구우면 조각마다 다른 암석 재질이 나와서, 맞닿는 선에서 갈라집니다
//   (이 프로젝트가 처음에 지적받은 「절벽면이랑 비탈길 벽면 통일감」 문제).
//   한 덩이 = 재질 하나 = 드로우콜 하나 = **이음매가 생길 자리가 없음**입니다.
//
// [왜 평면 투영을 축마다 나누는가]
//   전부 위에서 내려다본 XZ 평면으로 펴면, 74° 인 절벽면은 cos74° = 0.28 이라
//   **3.6 배로 늘어납니다.** 그래서 서 있는 면(절벽)은 옆(XY)에서 폅니다.
//   두 투영은 **아틀라스의 서로 다른 칸**에 들어가므로 섞이지 않습니다.
//
// [텍셀 배분 — 아틀라스를 우리가 짜서 얻는 이득]
//   4K(4096²) 한 장 기준. 면적에 비례해 나누면 절벽이 손해입니다.
//   절벽은 코앞에서 보고 땅은 발밑으로 스쳐 지나가므로 **절벽에 두 배**를 줍니다.
//     바닥칸  4096 × 2560 px  ←  코어 80 × 50 m   →  51 px/m (2.0 cm/텍셀)
//     절벽칸  2253 × 1515 px  ←  절벽 23 × 15.5 m →  98 px/m (1.0 cm/텍셀)
//
// [기하는 한 점도 안 건드립니다]
//   좌표는 그대로 두고 UV 속성만 **더합니다.** 그래야 구운 뒤에도
//   `맞춤.mjs`·`구멍2.mjs`·`걷기2.mjs` 숫자가 안 변합니다 —
//   숫자가 변하면 그건 에셋이 판정을 건드렸다는 뜻이고, 바로 잡을 수 있습니다.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { 미터, 코어, 절벽 } from "./공간도면.js";

// 칸 가장자리 여백 — 텍스처가 이웃 칸으로 번지는 것을 막는다
const 여백 = 0.004;

// ── 아틀라스 칸 배치 (0~1 UV 공간) ─────────────────────────
//   v 를 0.625 에서 자른 이유: 코어가 80 × 50 m 라 가로세로비 1.6 이다.
//   1.0 × 0.625 여야 **가로세로 텍셀 밀도가 같아진다**(안 그러면 늘어난다).
export const 아틀라스배치 = {
  바닥: { u: [0, 1], v: [0, 0.625] },
  절벽: { u: [0, 0.56], v: [0.63, 1] },
};

// ── 어느 메시를 어느 칸에 넣는가 ───────────────────────────
//   씬의 `name` 으로 고른다(공간그레이박스.jsx 가 붙여 둔 이름).
//   ※ `절벽조각.너덜`(절벽 발치 돌무더기)은 **절벽 칸**이다.
//     바닥 칸(위에서 편 투영)에 넣었더니 수직 벽에 붙은 돌들이 흰 얼룩으로
//     뭉갰다 — 체커를 입혀 보고 잡았다(UV미리보기.mjs). 22 × 3 m 짜리
//     가로로 긴 무더기라 옆에서 펴는 쪽이 맞고, 아틀라스에서도 절벽 바로
//     아래에 붙어서 Meshy 가 **이어지는 암석**으로 칠하기 좋다.
export const 굽기대상 = {
  바닥: ["땅", "길", "비탈"],
  절벽: ["절벽면", "절벽조각.너덜"],
};

// ── 투영 상자 (미터) ───────────────────────────────────────
//   지오메트리에서 재지 않고 **도면 숫자로 고정**한다.
//   그래야 절벽 높이를 조금 바꿔도 UV 가 통째로 밀리지 않는다.
const 상자 = {
  바닥: {
    min: [코어.X[0], 0, 코어.Z[0]],
    max: [코어.X[1], 0, 코어.Z[1]],
  },
  절벽: {
    min: [절벽.X[0] - 0.5, -0.5, 0],
    max: [절벽.X[1] + 0.5, 15.0, 0],
  },
};

// 흩어진 돌·퇴화면이 빌려 쓰는 순수 암반 구역(절벽 칸 안쪽)
const 바위칸 = { u: [0.08, 0.45], v: [0.72, 0.95] };

// ── 조각 하나에 평면 UV 를 얹는다 ──────────────────────────
//   축 "XZ" = 위에서 내려다본 투영 (누워 있는 면)
//   축 "XY" = 옆에서 본 투영       (서 있는 면)
// [퇴화면 대체 — 검은 쐐기의 정체]
//   옆에서 편 투영(XY)은 **법선이 ±X 인 면**을 한 줄로 뭉갠다. 투영 면적이 0 이라
//   텍스처가 한 줄만 늘어붙고, 해까지 등지면 새까맣게 보인다.
//   실제로 절벽 서쪽 **마구리면**(x = 34.0, 법선 (1,0,0))이 그렇게 나왔다
//   — 광선으로 찍어 확인했다(u = 0.023, 칸 왼쪽 끝).
//   그래서 **삼각형마다** 이 투영에 맞는 면인지 보고, 안 맞으면 바위칸으로 보낸다.
//   그 면들은 어차피 깎여 드러난 암반이라 화강암을 입는 게 맞다.
function 평면UV(지오, 축, 상자, 칸) {
  const p = 지오.attributes.position;
  const 좌표 = p.array;
  const [ai, bi] = 축 === "XZ" ? [0, 2] : [0, 1];
  const 법선축 = 축 === "XZ" ? 1 : 2; // 이 축을 보는 면이라야 이 투영이 성립한다
  // 지오메트리는 유닛, 상자는 미터 — 상자를 유닛으로 맞춘다
  const 최소a = 상자.min[ai] * 미터;
  const 최소b = 상자.min[bi] * 미터;
  const 폭 = (상자.max[ai] - 상자.min[ai]) * 미터;
  const 높 = (상자.max[bi] - 상자.min[bi]) * 미터;

  const 칸폭 = 칸.u[1] - 칸.u[0] - 여백 * 2;
  const 칸높 = 칸.v[1] - 칸.v[0] - 여백 * 2;
  // 가로세로비를 지킨다 — 안 지키면 텍스처가 한쪽으로 늘어난다
  const 배 = Math.min(칸폭 / 폭, 칸높 / 높);
  const 밀u = 칸.u[0] + 여백 + (칸폭 - 폭 * 배) / 2;
  const 밀v = 칸.v[0] + 여백 + (칸높 - 높 * 배) / 2;

  const uv = new Float32Array(p.count * 2);
  const 칸크기 = 3 * 미터;
  let 대체 = 0;
  for (let t = 0; t + 2 < p.count; t += 3) {
    const i0 = t * 3, i1 = (t + 1) * 3, i2 = (t + 2) * 3;
    const ux = 좌표[i1] - 좌표[i0], uy = 좌표[i1 + 1] - 좌표[i0 + 1], uz = 좌표[i1 + 2] - 좌표[i0 + 2];
    const wx = 좌표[i2] - 좌표[i0], wy = 좌표[i2 + 1] - 좌표[i0 + 1], wz = 좌표[i2 + 2] - 좌표[i0 + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    const 길이 = Math.hypot(n[0], n[1], n[2]);
    // 이 투영에 대해 면이 얼마나 서 있나 — 0.30 이면 약 72° 까지 허용
    const 맞음 = 길이 > 1e-9 && Math.abs(n[법선축]) / 길이 > 0.3;
    if (맞음) {
      for (let k = 0; k < 3; k++) {
        const j = (t + k) * 3;
        uv[(t + k) * 2] = 밀u + (좌표[j + ai] - 최소a) * 배;
        uv[(t + k) * 2 + 1] = 밀v + (좌표[j + bi] - 최소b) * 배;
      }
    } else {
      상자투영(좌표, t, uv, 칸크기);
      대체++;
    }
  }
  지오.userData.퇴화면대체 = 대체;
  지오.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return 지오;
}

// ── 흩어진 바위에 화강암을 입히는 UV ──────────────────────
// [왜 필요한가]
//   자갈·구역바위·발치너덜·길가돌은 아틀라스에 제 자리가 없어서 구운 재질을
//   못 받았다. 그래서 텍스처가 입혀진 절벽 앞에 **민짜 회색 다면체**로 남아,
//   붙어 있는데도 **공중에 떠 보인다**(사용자 지적). 실측으로도 이 메시들만
//   MeshLambert + 정점색으로 남아 있었다.
//
// [어떻게]
//   흩어진 돌에 평면 투영을 쓰면 늘어난다. 그래서 **삼각형마다 지배축을 골라
//   상자 투영**하고, 그 결과를 아틀라스의 **절벽 칸 한가운데(순수 화강암 구역)**
//   로 접어 넣는다. 돌마다 화강암의 서로 다른 자리를 보게 되므로 반복이 눈에 덜 띈다.
//
//   ※ 접는 기준을 **삼각형 무게중심**으로 잡는다. 꼭짓점마다 따로 접으면
//     한 삼각형이 아틀라스를 가로질러 늘어난다(UV 이음매).
//
// [바위칸] 절벽 칸 안쪽에서 발치 너덜·가장자리를 피한 순수 암반 구역이다.
//   여기 값이 절벽 칸 밖으로 나가면 땅 그림을 물어 와서 돌이 흙색이 된다.


// 삼각형 하나를 바위칸으로 상자 투영한다(면의 지배축을 골라 쓴다)
function 상자투영(좌표, t, uv, 칸크기) {
  const i0 = t * 3, i1 = (t + 1) * 3, i2 = (t + 2) * 3;
  const ux = 좌표[i1] - 좌표[i0], uy = 좌표[i1 + 1] - 좌표[i0 + 1], uz = 좌표[i1 + 2] - 좌표[i0 + 2];
  const wx = 좌표[i2] - 좌표[i0], wy = 좌표[i2 + 1] - 좌표[i0 + 1], wz = 좌표[i2 + 2] - 좌표[i0 + 2];
  const nx = Math.abs(uy * wz - uz * wy);
  const ny = Math.abs(uz * wx - ux * wz);
  const nz = Math.abs(ux * wy - uy * wx);
  let a, b;
  if (nx >= ny && nx >= nz) { a = 2; b = 1; }
  else if (ny >= nz) { a = 0; b = 2; }
  else { a = 0; b = 1; }
  const 폭 = 바위칸.u[1] - 바위칸.u[0];
  const 높 = 바위칸.v[1] - 바위칸.v[0];
  // 무게중심이 속한 칸을 빼서 삼각형이 통째로 한 칸 안에 남게 한다
  const 접a = Math.floor((좌표[i0 + a] + 좌표[i1 + a] + 좌표[i2 + a]) / 3 / 칸크기);
  const 접b = Math.floor((좌표[i0 + b] + 좌표[i1 + b] + 좌표[i2 + b]) / 3 / 칸크기);
  for (let k = 0; k < 3; k++) {
    const j = (t + k) * 3;
    const fa = THREE.MathUtils.clamp(좌표[j + a] / 칸크기 - 접a, 0, 1);
    const fb = THREE.MathUtils.clamp(좌표[j + b] / 칸크기 - 접b, 0, 1);
    uv[(t + k) * 2] = 바위칸.u[0] + fa * 폭;
    uv[(t + k) * 2 + 1] = 바위칸.v[0] + fb * 높;
  }
}

export function 바위UV얹기(지오, 타일 = 3) {
  const p = 지오.attributes.position;
  if (지오.index) return false; // 비인덱스만 다룬다(삼각형마다 접어야 하므로)
  const 좌표 = p.array;
  const uv = new Float32Array(p.count * 2);
  const 칸크기 = 타일 * 미터; // 지오메트리는 유닛
  for (let t = 0; t < p.count; t += 3) 상자투영(좌표, t, uv, 칸크기);
  지오.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return true;
}

// 구운 재질을 같이 입힐 '돌붙이' 메시들 — 아틀라스에 제 자리는 없고
// 절벽 칸의 화강암을 빌려 쓴다.
export const 바위대상 = [
  "땅.알",
  "z.지오",
  "b.바위",
  "차단물조형.발치너덜",
  "길조형.돌",
  "길조형.틈바위",
  "길조형.비탈바위",
  "절벽조각.덩어리",
];

// ── 살아 있는 메시에 같은 UV 를 얹는다 ─────────────────────
//   구운 텍스처를 **원본 메시**에 붙이려면, 내보낼 때 쓴 UV 와
//   **똑같은 UV** 가 화면 쪽 지오메트리에도 있어야 한다.
//   같은 함수(`평면UV`)를 쓰므로 어긋날 수가 없다.
export function 칸UV얹기(지오, 칸이름) {
  if (!아틀라스배치[칸이름]) return false;
  평면UV(지오, 칸이름 === "절벽" ? "XY" : "XZ", 상자[칸이름], 아틀라스배치[칸이름]);
  return true;
}

// 이름으로 어느 칸인지 되찾는다
export function 칸찾기(이름) {
  for (const [칸, 목록] of Object.entries(굽기대상))
    if (목록.includes(이름)) return 칸;
  return null;
}

// ── 세계 사각형 → 아틀라스 사각형 ──────────────────────────
// [왜 필요한가]
//   구역마다 따로 구우려면 「Z1 은 아틀라스의 어느 사각형인가」를 알아야 한다.
//   바닥 칸은 **위에서 내려다본 평면 투영**이라, 세계의 직사각형이 아틀라스에서도
//   축에 나란한 직사각형이 된다 — 그래서 오려 붙이기가 성립한다.
//
// [중복 정의를 만들지 않는다]
//   이 값을 합치는 도구(텍스처합치기.mjs)가 **다시 계산하면** 언젠가 어긋난다.
//   그래서 내보낼 때 이 사각형을 GLB 옆에 .json 으로 같이 적어 둔다.
//   도구는 그걸 읽기만 한다. 진실은 여기 한 곳이다.
export function 바닥칸사각형(Xm, Zm) {
  const 칸 = 아틀라스배치.바닥;
  const b = 상자.바닥;
  const 최소a = b.min[0] * 미터;
  const 최소b = b.min[2] * 미터;
  const 폭 = (b.max[0] - b.min[0]) * 미터;
  const 높 = (b.max[2] - b.min[2]) * 미터;
  const 칸폭 = 칸.u[1] - 칸.u[0] - 여백 * 2;
  const 칸높 = 칸.v[1] - 칸.v[0] - 여백 * 2;
  const 배 = Math.min(칸폭 / 폭, 칸높 / 높);
  const 밀u = 칸.u[0] + 여백 + (칸폭 - 폭 * 배) / 2;
  const 밀v = 칸.v[0] + 여백 + (칸높 - 높 * 배) / 2;
  const uv = (x, z) => [
    밀u + (x * 미터 - 최소a) * 배,
    밀v + (z * 미터 - 최소b) * 배,
  ];
  const [u0, v0] = uv(Xm[0], Zm[0]);
  const [u1, v1] = uv(Xm[1], Zm[1]);
  return { u: [Math.min(u0, u1), Math.max(u0, u1)], v: [Math.min(v0, v1), Math.max(v0, v1)] };
}

// ── 씬에서 지형 조각을 모아 한 덩이로 ──────────────────────
//   ※ 원본 지오메트리는 건드리지 않는다(씬은 계속 돌아야 하므로 clone).
//   ※ 정점색(`정점색: true`)을 실어 보낼지는 **골라야 한다.**
//     - 처음에는 버렸다. 「우리 회색이 구운 결과에 물들까 봐」였다.
//       그런데 돌아온 텍스처가 **거의 백색 단색**이었다. 평평한 회색 덩어리를
//       줬으니 Meshy 가 색을 잡을 단서가 없었던 것이다.
//     - 우리 정점색은 `지표.색` 이 구역·젖음·굴곡까지 따져 칠한 값이다.
//       그걸 실어 보내면 「여기는 마른 흙, 저기는 젖은 자갈」이 그림으로 전달된다.
//     그래서 옵션으로 뒀다. 둘을 나란히 굽고 비교하면 답이 나온다.
//   ※ `칸` 을 주면 **그 칸만** 모은다(예: "절벽").
//     UV 는 전체 아틀라스 배치를 그대로 쓰므로, 칸별로 따로 구워도
//     돌아온 그림을 **같은 아틀라스 자리에 그대로 합칠 수 있다.**
//     Meshy 가 한 모델에 재질 하나만 입히는 성질(2차까지 확인)을 우회하는 길이다.
//   ※ `구역` 을 주면 **그 세계 사각형 안의 삼각형만** 남긴다(무게중심 기준).
//     UV 는 손대지 않으므로, 돌아온 그림에서 그 구역의 아틀라스 사각형만
//     오려 붙이면 된다 — 구역마다 다른 재질을 입힐 수 있게 된다.
export function 지형모으기(씬, { 정점색 = false, 칸 = null, 구역 = null } = {}) {
  const 조각 = [];
  const 통계 = {};

  for (const [칸이름, 이름들] of Object.entries(굽기대상)) {
    if (칸 && 칸이름 !== 칸) continue;
    씬.traverse((o) => {
      if (!o.isMesh || !이름들.includes(o.name)) return;
      const g = o.geometry.clone();
      // 부모 변환까지 반영해 월드 좌표로 굳힌다
      o.updateWorldMatrix(true, false);
      g.applyMatrix4(o.matrixWorld);
      // 속성 통일 — mergeGeometries 는 속성 구성이 **똑같아야** 합친다
      const 남길 = 정점색 ? ["position", "normal", "color"] : ["position", "normal"];
      for (const k of Object.keys(g.attributes))
        if (!남길.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      // 색 없는 조각이 섞이면 합치기가 실패한다 — 흰색으로 채워 형식을 맞춘다
      if (정점색 && !g.attributes.color) {
        const n = g.attributes.position.count;
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      if (g.index) {
        const n = g.toNonIndexed();
        g.dispose();
        평면UV(n, 칸이름 === "절벽" ? "XY" : "XZ", 상자[칸이름], 아틀라스배치[칸이름]);
        조각.push(n);
      } else {
        평면UV(g, 칸이름 === "절벽" ? "XY" : "XZ", 상자[칸이름], 아틀라스배치[칸이름]);
        조각.push(g);
      }
      통계[칸이름] = (통계[칸이름] ?? 0) + o.geometry.attributes.position.count / 3;
    });
  }

  if (!조각.length) return null;
  let 합본 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());

  if (구역) {
    합본 = 사각형으로자르기(합본, 구역, 구역.사각형 ?? null);
    if (!합본) return null;
  }
  합본.computeBoundingBox();
  return { 지오: 합본, 통계 };
}

// ── 우리 색을 아틀라스 그림으로 굽는다 ─────────────────────
// [왜 필요한가]
//   1차 굽기는 색 없이 넘겼더니 **거의 백색 단색**으로 돌아왔다.
//   2차로 정점색(COLOR_0)을 실어 보냈더니 Meshy 가 **모델 처리에서 실패**했다.
//   → 정점색 속성은 안 받는 것으로 보인다.
//
//   그래서 색을 **속성이 아니라 그림으로** 넘긴다. UV 공간에 우리 정점색을
//   그대로 펼쳐 그려서 baseColorTexture 로 넣으면,
//   GLB 구조가 1차(성공한 것)와 똑같아지고 — POSITION·NORMAL·TEXCOORD_0,
//   재질 하나 — 거기에 텍스처만 붙는다. `Keep Original Texture and UV` 가
//   원래 다루라고 만들어진 형태다.
//
// [세로 방향 — 한 번 틀렸다가 잡은 것]
//   처음에 「glTF 는 원점이 위, GL 프레임버퍼는 0행이 아래니까 뒤집자」고 했는데
//   **뒤집으면 안 된다.** 우리는 위치를 `ndc.y = v*2-1` 로 놓으므로
//   v = 0 이 프레임버퍼 **0행(아래)** 에 그려진다. 그리고 PNG 의 **0행은 위**이고
//   glTF 규약에서 위가 v = 0 이다. 즉 프레임버퍼 0행 → 이미지 0행 이 곧 v=0 → v=0 이라
//   **그대로 담으면 맞는다.** 뒤집었더니 절벽 칸이 위로 올라가 버렸다(실제로 그랬다).
//
// [색공간]
//   렌더 타깃에 그냥 그리면 **선형(linear) 값**이 담긴다. 그걸 sRGB 그림이라고
//   이름 붙이면 색이 탁하고 어둡게 나온다. 타깃 텍스처에 sRGB 를 지정해서
//   렌더러가 쓰기 전에 변환하게 한다.
export function 밑그림굽기(그리개, 지오, 크기 = 2048) {
  const p = 지오.attributes.position;
  const uv = 지오.attributes.uv;
  const 색 = 지오.attributes.color;
  if (!uv || !색) throw new Error("밑그림을 구우려면 uv 와 color 가 둘 다 있어야 한다");

  // 위치를 UV 로 갈아 끼운 납작한 지오 — 아틀라스를 정면에서 본 셈이 된다
  const 납작 = new THREE.BufferGeometry();
  const 자리 = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    자리[i * 3] = uv.getX(i) * 2 - 1;
    자리[i * 3 + 1] = uv.getY(i) * 2 - 1;
  }
  납작.setAttribute("position", new THREE.BufferAttribute(자리, 3));
  납작.setAttribute("color", 색.clone());

  const 씬 = new THREE.Scene();
  const 메시 = new THREE.Mesh(
    납작,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  씬.add(메시);
  const 눈 = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const 판 = new THREE.WebGLRenderTarget(크기, 크기);
  판.texture.colorSpace = THREE.SRGBColorSpace; // 위 [색공간] 참고

  const 옛판 = 그리개.getRenderTarget();
  const 옛색 = new THREE.Color();
  그리개.getClearColor(옛색);
  const 옛알파 = 그리개.getClearAlpha();

  그리개.setRenderTarget(판);
  // 빈 칸은 흙색으로 채운다 — 검게 두면 Meshy 가 그늘이나 구멍으로 읽는다
  그리개.setClearColor(0x8a7c63, 1);
  그리개.clear();
  그리개.render(씬, 눈);

  const 픽셀 = new Uint8Array(크기 * 크기 * 4);
  그리개.readRenderTargetPixels(판, 0, 0, 크기, 크기, 픽셀);
  그리개.setRenderTarget(옛판);
  그리개.setClearColor(옛색, 옛알파);
  판.dispose();
  납작.dispose();
  메시.material.dispose();

  const 천 = document.createElement("canvas");
  천.width = 천.height = 크기;
  const 붓 = 천.getContext("2d");
  const 그림 = 붓.createImageData(크기, 크기);
  // 뒤집지 않는다 — 위 [세로 방향] 참고
  그림.data.set(픽셀);
  붓.putImageData(그림, 0, 0);
  return 천;
}

// 무게중심이 세계 사각형 안에 있는 삼각형만 남긴다.
// [UV 를 0~1 로 편다 — Meshy 가 거부해서 넣은 것]
//   구역 하나는 아틀라스의 5 % 남짓만 쓴다(Z2 는 4.7 %). 그대로 올렸더니
//   Meshy 가 **「UV 커버리지가 너무 작다」로 못 불러왔다.**
//   그래서 그 구역의 아틀라스 사각형이 0~1 을 꽉 채우도록 UV 를 펴서 넘긴다.
//   덤으로 4K 한 장을 그 구역이 통째로 쓰게 되어 텍셀 밀도도 올라간다.
//   합칠 때는 돌아온 그림 **전체**를 그 사각형에 도로 넣으면 된다(쪽지의 `채움`).
//
//   ※ 사각형 밖으로 나가는 삼각형(급사면 → 바위칸)은 **버린다.**
//     어차피 최종 화면에서 그 면들은 바위칸을 보므로 구역 굽기와 무관하다.
function 사각형으로자르기(지오, { X, Z }, 펴기 = null) {
  const p = 지오.attributes.position;
  const uv = 지오.attributes.uv;
  const 속성 = Object.keys(지오.attributes);
  const 남길 = [];
  const 안 = (u, v) =>
    !펴기 ||
    (u >= 펴기.u[0] - 1e-4 && u <= 펴기.u[1] + 1e-4 &&
     v >= 펴기.v[0] - 1e-4 && v <= 펴기.v[1] + 1e-4);
  for (let t = 0; t + 2 < p.count; t += 3) {
    const cx =
      (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3 / 미터;
    const cz =
      (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3 / 미터;
    if (!(cx >= X[0] && cx <= X[1] && cz >= Z[0] && cz <= Z[1])) continue;
    if (uv && 펴기) {
      let 모두안 = true;
      for (let i = 0; i < 3; i++)
        if (!안(uv.getX(t + i), uv.getY(t + i))) { 모두안 = false; break; }
      if (!모두안) continue;
    }
    남길.push(t);
  }
  if (!남길.length) return null;
  const 새 = new THREE.BufferGeometry();
  for (const 이름 of 속성) {
    const a = 지오.attributes[이름];
    const n = a.itemSize;
    const 통 = new Float32Array(남길.length * 3 * n);
    let k = 0;
    for (const t of 남길)
      for (let i = 0; i < 3; i++)
        for (let c = 0; c < n; c++) 통[k++] = a.array[(t + i) * n + c];
    새.setAttribute(이름, new THREE.BufferAttribute(통, n));
  }
  // UV 를 0~1 로 편다
  if (펴기 && 새.attributes.uv) {
    const a = 새.attributes.uv.array;
    const du = 펴기.u[1] - 펴기.u[0];
    const dv = 펴기.v[1] - 펴기.v[0];
    for (let i = 0; i < a.length; i += 2) {
      a[i] = THREE.MathUtils.clamp((a[i] - 펴기.u[0]) / du, 0, 1);
      a[i + 1] = THREE.MathUtils.clamp((a[i + 1] - 펴기.v[0]) / dv, 0, 1);
    }
    새.attributes.uv.needsUpdate = true;
  }
  지오.dispose();
  return 새;
}

// ── GLB 로 뽑는다 ──────────────────────────────────────────
//   Meshy 업로드는 glb/gltf/obj/fbx/stl 을 받고 100 MB 까지다.
//   우리 지형은 위치+법선+UV 만 담아 약 8~9 MB 다(한도의 9 %).
export function 지형GLB(씬, 선택 = {}, 그리개 = null) {
  // 밑그림을 구우려면 색을 모아야 한다(그림으로 바꾼 뒤엔 속성을 버린다)
  const 색필요 = !!(선택.정점색 || 선택.밑그림);
  const 모음 = 지형모으기(씬, { 정점색: 색필요, 칸: 선택.칸 ?? null, 구역: 선택.구역 ?? null });
  if (!모음) return Promise.reject(new Error("구울 지형 조각을 못 찾았다"));

  let 밑그림천 = null;
  if (선택.밑그림) {
    if (!그리개) return Promise.reject(new Error("밑그림을 구우려면 렌더러가 필요하다"));
    밑그림천 = 밑그림굽기(그리개, 모음.지오, 선택.밑그림크기 ?? 2048);
    // Meshy 가 COLOR_0 에서 처리 실패했다 — 그림으로 옮겼으니 속성은 버린다
    if (!선택.정점색) 모음.지오.deleteAttribute("color");
  }

  const 재질 = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: !!모음.지오.attributes.color,
  });
  if (밑그림천) {
    const 텍 = new THREE.CanvasTexture(밑그림천);
    텍.flipY = false; // glTF 규약
    텍.colorSpace = THREE.SRGBColorSpace;
    재질.map = 텍;
  }
  const 메시 = new THREE.Mesh(모음.지오, 재질);
  메시.name = "NAJU01_지형";
  return new Promise((맞음, 틀림) => {
    new GLTFExporter().parse(
      메시,
      (결과) => 맞음({ 버퍼: 결과, 통계: 모음.통계 }),
      (e) => 틀림(e),
      { binary: true },
    );
  });
}
