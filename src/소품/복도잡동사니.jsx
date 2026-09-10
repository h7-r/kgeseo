// 복도잡동사니.jsx — 비밀복도 바닥에 흩어진 생활 쓰레기·잔해
//
// [왜 넣는가]
//   빈 바닥은 '아직 안 만든 곳'으로 읽힌다. 캔 하나, 구겨진 종이 한 장이
//   "여기 사람이 있었고, 그 뒤로 오래 비어 있었다"를 한 번에 말해 준다.
//   복도는 지나가는 곳이라 큰 소품을 놓을 수 없다 — 바닥에 눕는 것이 답이다.
//
// [왜 전부 한 덩어리로 합치나]
//   물건 40개를 따로 그리면 외곽선까지 80 드로우콜이다. 복도는 이미 벽·배관·
//   자판기로 무거운데 쓰레기가 그만큼을 더 먹을 이유가 없다.
//   → 지오메트리를 하나로 합치고, 색은 **정점색**으로 물건마다 다르게 넣는다.
//     벽이 깊이 감광을 정점색으로 하는 것과 같은 방식이라 화풍도 그대로다.
//     결과: 잡동사니 전부가 메시 1개 + 외곽선 1개 = 2 드로우콜.
//
// [깊이 감광]
//   복도 안쪽으로 갈수록 어두워지는 규칙을 물건에도 똑같이 먹인다.
//   안 그러면 어두운 복도 끝에 쓰레기만 혼자 환하게 떠 있다.

import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TOON_GRADIENT, 만화선, makeRandom } from "../공용.jsx";

// ── 낱개 모양 — 한 번만 만들어 모두가 돌려 쓴다 ──────────────
//   합칠 때 clone 해서 크기·회전·자리만 바꾸므로 원본은 안 건드린다.
const 모양 = {
  캔: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  컵: new THREE.CylinderGeometry(0.5, 0.36, 1, 8, 1),
  뚜껑: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  뭉친종이: new THREE.IcosahedronGeometry(0.5, 0),
  판: new THREE.BoxGeometry(1, 1, 1), // 전단지·신문·각목·콘크리트 조각 공용
};

// ── 종류표 — 크기·색·자세를 한곳에 모아 둔다 ────────────────
//   [눕히기] 캔·컵은 원기둥 축이 Y 라, 옆으로 눕히려면 X 로 90° 돌린다.
const 종류들 = [
  {
    이름: "캔",
    모양: "캔",
    무게: 5,
    크기: () => [0.17, 0.42, 0.17],
    눕힘: Math.PI / 2,
    색: ["#9aa6b2", "#8f9aa6", "#a4534a", "#3f6ea8", "#4e8f5c"],
  },
  {
    이름: "종이컵",
    모양: "컵",
    무게: 3,
    크기: () => [0.15, 0.3, 0.15],
    눕힘: Math.PI / 2,
    색: ["#d6cfbe", "#c6bfae"],
  },
  {
    이름: "구겨진종이",
    모양: "뭉친종이",
    무게: 5,
    크기: (r) => {
      const s = 0.13 + r() * 0.08;
      return [s, s * 0.8, s];
    },
    색: ["#cfc9b8", "#bdb7a6", "#d8d2c2"],
  },
  {
    이름: "전단지",
    모양: "판",
    무게: 5,
    크기: (r) => [0.24 + r() * 0.14, 0.008, 0.18 + r() * 0.12],
    바닥붙음: true,
    색: ["#c9c3b2", "#bab4a3", "#d2ccbb"],
  },
  {
    이름: "각목",
    모양: "판",
    무게: 2,
    크기: (r) => [0.7 + r() * 0.6, 0.06, 0.08 + r() * 0.04],
    색: ["#6b5a44", "#5d4e3b", "#75634b"],
  },
  {
    이름: "콘크리트조각",
    모양: "판",
    무게: 4,
    크기: (r) => {
      const s = 0.08 + r() * 0.1;
      return [s, s * 0.7, s * 0.85];
    },
    색: ["#6a6d73", "#5c5f65", "#767980"],
  },
  {
    이름: "병뚜껑",
    모양: "뚜껑",
    무게: 2,
    크기: () => [0.055, 0.02, 0.055],
    색: ["#a4534a", "#8a8f96", "#3f6ea8"],
  },
  {
    이름: "담배꽁초",
    모양: "뚜껑",
    무게: 3,
    크기: () => [0.022, 0.075, 0.022],
    눕힘: Math.PI / 2,
    색: ["#d8d2c2", "#c2a86a"],
  },
];

// 무게(빈도)를 펼친 뽑기표 — 캔·종이가 자주, 각목이 드물게 나온다
const 뽑기표 = 종류들.flatMap((t, i) => Array(t.무게).fill(i));

const _색 = new THREE.Color();

/**
 * 잡동사니 지오메트리 한 덩어리를 만든다.
 * @param 밝기 (z) => 0~1  복도 깊이 감광. 물건 색에 곱해 정점색으로 굽는다.
 */
function 잡동사니지오({ x0, x1, z0, z1, 개수, seed, 밝기, 바닥y }) {
  const r = makeRandom(seed);
  const 폭 = x1 - x0;
  const 조각 = [];

  for (let i = 0; i < 개수; i++) {
    const t = 종류들[뽑기표[Math.floor(r() * 뽑기표.length)]];
    const [sx, sy, sz] = t.크기(r);

    // ★ 벽 쪽으로 쏠리게 놓는다.
    //   쓸려 다니는 쓰레기는 한가운데가 아니라 벽 밑에 모인다.
    //   가운데를 비워 두면 지나다니는 길도 자연히 생긴다.
    const 벽쪽 = r() < 0.7;
    const u = 벽쪽
      ? (r() < 0.5 ? 0.06 : 0.94) + (r() - 0.5) * 0.16
      : 0.2 + r() * 0.6;
    const x = x0 + Math.min(0.96, Math.max(0.04, u)) * 폭;
    const z = z0 + r() * (z1 - z0);

    // ★ 반드시 비인덱스로 맞춘다.
    //   Icosahedron 은 인덱스가 없고 Box·Cylinder 는 있다. 섞어서 합치려 하면
    //   mergeGeometries 가 "attributes 가 안 맞는다"며 null 을 돌려준다
    //   (그러면 잡동사니가 통째로 안 보인다).
    //   flatShading 을 쓰므로 어차피 비인덱스가 맞다.
    const 원 = 모양[t.모양];
    const g = 원.index ? 원.toNonIndexed() : 원.clone();
    g.scale(sx, sy, sz);
    if (t.눕힘) g.rotateX(t.눕힘); // 원기둥을 옆으로 눕힌다
    g.rotateY(r() * Math.PI * 2);
    // 바닥에 딱 붙는 것(전단지)은 안 기울인다. 나머지는 살짝 기운다.
    if (!t.바닥붙음) {
      g.rotateX((r() - 0.5) * 0.5);
      g.rotateZ((r() - 0.5) * 0.5);
    }
    // 실제 높이를 재서 밑면이 바닥에 닿게 올린다(공중에 뜨지 않게)
    // ★ 복도 바닥판은 y=0 이 아니라 **0.01** 에 깔려 있다.
    //   0 기준으로 앉히면 물건 밑동이 바닥에 살짝 파묻힌다.
    g.computeBoundingBox();
    const 밑 = g.boundingBox.min.y;
    g.translate(x, -밑 + 바닥y + 0.002, z);

    // 정점색 — 물건 색 × 그 자리의 깊이 밝기 × 약간의 개체차
    const 기본 = t.색[Math.floor(r() * t.색.length)];
    const 개체 = 0.85 + r() * 0.3;
    _색.set(기본).multiplyScalar(Math.max(0.12, 밝기(z) * 개체));
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      c[k * 3] = _색.r;
      c[k * 3 + 1] = _색.g;
      c[k * 3 + 2] = _색.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    조각.push(g);
  }
  if (!조각.length) return null;
  const 합 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합;
}

// 물웅덩이 — 천장 배관에서 샌 물. 납작한 타원 한 장씩.
//   외곽선을 안 두른다 — 물에 테두리를 그으면 스티커처럼 보인다.
function 웅덩이지오({ x0, x1, z0, z1, 개수, seed, 밝기, 바닥y }) {
  const r = makeRandom(seed + 991);
  const 조각 = [];
  for (let i = 0; i < 개수; i++) {
    const x = x0 + (0.15 + r() * 0.7) * (x1 - x0);
    const z = z0 + r() * (z1 - z0);
    const g = new THREE.CircleGeometry(0.5, 18);
    g.rotateX(-Math.PI / 2);
    g.scale(0.9 + r() * 1.5, 1, 0.6 + r() * 1.1);
    g.rotateY(r() * Math.PI);
    // 바닥판 바로 위. 너무 붙이면 멀리서 두 면이 깜빡인다(z-fighting).
    g.translate(x, 바닥y + 0.01, z);
    const v = Math.max(0.1, 밝기(z));
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      c[k * 3] = 0.06 * v;
      c[k * 3 + 1] = 0.075 * v;
      c[k * 3 + 2] = 0.09 * v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    조각.push(g);
  }
  if (!조각.length) return null;
  const 합 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합;
}

export function 복도잡동사니({
  x0,
  x1,
  z0,
  z1,
  개수, // 안 주면 복도 길이에 맞춰 알아서
  웅덩이 = 3,
  바닥y = 0.01, // 복도 바닥판이 깔린 높이 (비밀복도의 바닥 mesh y)
  seed = 4711,
  밝기 = () => 1,
  선,
}) {
  const 실개수 = 개수 ?? Math.round(Math.min(90, Math.max(8, (z1 - z0) * 0.55)));
  const 지오 = useMemo(
    () => 잡동사니지오({ x0, x1, z0, z1, 개수: 실개수, seed, 밝기, 바닥y }),
    // 밝기는 매 렌더 새 함수라 의존성에 넣으면 계속 다시 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x0, x1, z0, z1, 실개수, seed, 바닥y],
  );
  const 물 = useMemo(
    () => 웅덩이지오({ x0, x1, z0, z1, 개수: 웅덩이, seed, 밝기, 바닥y }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x0, x1, z0, z1, 웅덩이, seed, 바닥y],
  );
  useEffect(
    () => () => {
      지오?.dispose();
      물?.dispose();
    },
    [지오, 물],
  );

  return (
    <group>
      {지오 && (
        <mesh geometry={지오} castShadow receiveShadow>
          {/* 색은 전부 정점색에 구워 넣었다 → 재질 색은 흰색(그대로 통과) */}
          <meshToonMaterial
            vertexColors
            color="#ffffff"
            gradientMap={TOON_GRADIENT}
            flatShading
          />
          <만화선 선={선} />
        </mesh>
      )}
      {물 && (
        <mesh geometry={물}>
          <meshBasicMaterial
            vertexColors
            transparent
            opacity={0.55}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}
