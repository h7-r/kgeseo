// 복도잡동사니.jsx — 비밀복도 바닥에 흩어진 생활 쓰레기
//
// [왜 넣는가]
//   빈 바닥은 '아직 안 만든 곳'으로 읽힌다. 캔 하나, 구겨진 종이컵 하나가
//   "여기 사람이 있었고, 그 뒤로 오래 비어 있었다"를 한 번에 말해 준다.
//
// [모양이 전부다]
//   원기둥에 색만 칠하면 캔이 아니라 '캔이라고 우기는 통'이다.
//   버려진 캔이 캔으로 읽히는 건 **찌그러진 모양** 때문이다. 그래서 여기 물건은
//   전부 '옆선(프로파일)을 돌려 만든 뒤 손으로 찌그러뜨리는' 방식으로 만든다.
//     ① 옆선 → LatheGeometry (굽·몸통·어깨·목·테가 다 살아 있다)
//     ② 찌그러뜨리기 → 아코디언 주름 + 한쪽 눌림 + 높이 깎기
//   캔 라벨은 자판기에서 쓰는 **그 그림 그대로**다. 뽑아 마신 캔이라야 하니까.
//
// [왜 한 덩어리로 합치나]
//   40여 개를 따로 그리면 외곽선까지 80 드로우콜이다. 복도는 이미 벽·배관·
//   자판기로 무겁다. 그래서 재질이 같은 것끼리 합치고, 색은 **정점색**으로
//   물건마다 다르게 넣는다(벽이 깊이 감광을 하는 방식과 같다).
//     캔 1 · 나머지 1 · 웅덩이 1 + 물방울 몇 개.

import { useMemo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { 소리재생 } from "../소리.js";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TOON_GRADIENT, 만화선, makeRandom } from "../공용.jsx";
import { 캔종류, 캔라벨그리기 } from "./자판기.jsx";

// ── 찌그러뜨리기 ────────────────────────────────────────────
// 세기 0 = 멀쩡, 1 = 발로 밟아 납작.
//   ① 아코디언 주름 — 알루미늄이 접히는 방식. 높이를 따라 반지름이 물결친다.
//   ② 한쪽 눌림    — 밟힌 방향으로만 납작해진다(사방으로 줄면 그냥 작아진다).
//   ③ 높이 깎기    — 접힌 만큼 낮아진다.
//   ④ 축 휘기      — 접히면서 축이 살짝 S 자로 휜다.
function 찌그러뜨리기(g, 세기, r) {
  if (세기 <= 0) return g;
  const p = g.attributes.position;
  const 접힘 = 2 + Math.floor(r() * 3);
  const 위상 = r() * Math.PI * 2;
  const 방향 = r() * Math.PI * 2;
  const 휨 = (r() - 0.5) * 0.5 * 세기;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const 반 = Math.hypot(x, z);
    if (반 > 1e-5) {
      const 주름 = 1 + 세기 * 0.3 * Math.sin(y * Math.PI * 접힘 + 위상);
      const 각 = Math.atan2(z, x) - 방향;
      const c = Math.cos(각);
      const 납작 = 1 - 세기 * 0.62 * c * c;
      const k = 주름 * 납작;
      x *= k;
      z *= k;
    }
    y *= 1 - 세기 * 0.5;
    x += 휨 * Math.sin(y * 3.4);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// 옆선을 돌려 몸통을 만든다. 점은 [반지름, 높이] 목록.
const 돌리기 = (점들, 조각 = 10) =>
  new THREE.LatheGeometry(
    점들.map(([a, b]) => new THREE.Vector2(a, b)),
    조각,
  );

// 돌린 뒤 비인덱스로 바꾼다.
//   합칠 때 인덱스 유무가 섞이면 mergeGeometries 가 통째로 실패한다.
//   손볼 것(UV 옮기기)이 있으면 인덱스가 있는 동안 해야 정점 수가 적어 싸다.
function 돌려서굳히기(점들, 조각, 손질) {
  const a = 돌리기(점들, 조각);
  if (손질) 손질(a);
  const b = a.toNonIndexed();
  a.dispose();
  return b;
}

// ── 캔 — 굽·몸통·어깨·목·테가 있는 진짜 실루엣 ──────────────
//   높이 1 · 지름 1 로 만들고 쓸 때 크기를 준다.
//   ★ 몸통에 고리(가로줄)를 여러 개 둔다. 위아래 두 줄뿐이면 그 사이에 정점이
//     없어서 **아무리 찌그러뜨려도 주름이 안 잡힌다** — 통이 그냥 기울 뿐이다.
const 캔옆선 = [
  [0.0, 0.02],
  [0.3, 0.0], // 굽 안쪽(오목한 밑면)
  [0.44, 0.03],
  [0.47, 0.08], // 굽 테
  [0.5, 0.16],
  [0.5, 0.31], // ┐
  [0.5, 0.46], // │ 몸통 — 주름이 잡히는 자리
  [0.5, 0.61], // │
  [0.5, 0.76], // ┘
  [0.45, 0.86], // 어깨
  [0.36, 0.94], // 목
  [0.35, 1.0], // 윗 테
  [0.3, 0.98], // 뚜껑 안쪽
  [0.0, 0.97],
];

// ── 종이컵 — 아래가 좁고 위 테가 말려 있다 ──────────────────
const 컵옆선 = [
  [0.0, 0.0],
  [0.3, 0.0],
  [0.32, 0.03],
  [0.37, 0.31], // ┐ 몸통 고리 — 구겨질 자리
  [0.41, 0.58], // │
  [0.45, 0.86], // ┘
  [0.5, 0.94],
  [0.47, 1.0], // 말린 테
  [0.42, 0.96],
  [0.0, 0.95],
];

// ── 담배꽁초 — 필터(연갈색) + 타 버린 끝(검정) ──────────────
const 꽁초옆선 = [
  [0.0, 0.0],
  [0.5, 0.0],
  [0.5, 0.62],
  [0.46, 0.78],
  [0.34, 1.0],
  [0.0, 1.0],
];

// 위치로만 정해지는 잡음 — 같은 자리의 정점은 같은 값을 받는다.
//   (비인덱스 지오는 모서리마다 정점이 겹쳐 있어, 난수를 쓰면 면이 찢어진다)
function 자리잡음(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// ── 콘크리트 조각 — 모난 덩어리 ─────────────────────────────
function 콘크리트지오(r) {
  // IcosahedronGeometry 는 처음부터 비인덱스라 toNonIndexed 를 부르면 경고만 난다
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const p = g.attributes.position;
  const 씨 = r() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    // 반지름을 자리마다 들쭉날쭉하게 → 깨진 돌처럼 모가 난다
    const k = 0.62 + 0.7 * 자리잡음(x + 씨, y - 씨, z);
    p.setXYZ(i, x * k, y * k * 0.7, z * k);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ── 부서진 벽돌 ────────────────────────────────────────────
//   벽에서 떨어져 나온 조각이다. 반듯한 상자는 '벽돌'이 아니라 '상자'라,
//   깨진 쪽 면을 들쭉날쭉하게 부수고 모서리를 갉아 낸다.
//   @param 깨짐 0 = 온전한 벽돌, 1 = 반쯤 부서진 조각
function 벽돌지오(r, 깨짐 = 0.5) {
  const 판 = new THREE.BoxGeometry(1, 0.46, 0.3, 4, 2, 2);
  const g = 판.toNonIndexed();
  판.dispose();
  const p = g.attributes.position;
  const 씨 = r() * 8;
  const 부러진쪽 = r() < 0.5 ? 1 : -1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const j = 자리잡음(x * 7 + 씨, y * 7, z * 7);
    // ① 부러진 단면 — 한쪽 끝이 뭉텅 깨져 울퉁불퉁하다
    const 끝 = Math.max(0, x * 부러진쪽 - 0.12) / 0.38;
    // ② 모서리는 어디든 조금씩 갉아 먹혔다(오래된 벽돌은 각이 안 산다)
    const 갉음 = 0.03 * (j - 0.5);
    p.setXYZ(
      i,
      // ★ j(잡음)만 곱하면 j≈0 인 정점이 안 움직여 길이가 그대로다.
      //   고정분(0.3)을 더해야 '한 귀퉁이가 뭉텅 없어진' 반 토막이 된다.
      x - 부러진쪽 * 끝 * 깨짐 * (0.3 + 0.28 * j) + 갉음,
      y * (1 - 끝 * 깨짐 * 0.3 * j) + 갉음,
      z * (1 - 끝 * 깨짐 * 0.25 * (1 - j)) + 갉음,
    );
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// 벽돌 색 — 낡아서 붉은기가 죽은 흙빛. 회색 블록도 섞인다.
const 벽돌색조 = ["#6b4a3c", "#5e4438", "#734f3e", "#585a5e", "#4e463f"];
function 벽돌칠하기(g, r, 어둡) {
  const 바탕 = _색.set(벽돌색조[Math.floor(r() * 벽돌색조.length)]).clone();
  const 깨진면 = _색2.set("#8a7b6d").clone(); // 갓 깨진 속은 밝고 부슬부슬하다
  const 씨 = r() * 5;
  색굽기(g, null, (px, py, pz) => {
    const 알갱이 = 0.82 + 0.34 * 자리잡음(px * 24 + 씨, py * 24, pz * 24);
    // 옆면(길이 끝)일수록 깨진 속살이 드러난다
    const 속 = Math.max(0, Math.abs(px) - 0.3) * 1.6;
    const c = 바탕.clone().lerp(깨진면, Math.min(0.55, 속));
    const v = 어둡 * 알갱이;
    return [c.r * v, c.g * v, c.b * v];
  });
}

// ── 녹슨 철판 조각 — 한쪽이 휘어 들린 얇은 판 ───────────────
function 철판지오(r) {
  const 판 = new THREE.PlaneGeometry(1, 0.6, 4, 3);
  const g = 판.toNonIndexed();
  판.dispose();
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  // 말림이 세면 키운 뒤에 20cm 넘게 들려 '세워 둔 판'처럼 보인다
  const 휨 = 0.13 + r() * 0.2;
  const 씨 = r() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    // 한쪽 끝이 말려 들리고, 표면이 우글거린다(부식된 철판의 특징)
    const u = x + 0.5;
    const y = 휨 * u * u + 0.035 * Math.sin(x * 9 + 씨) * Math.cos(z * 11);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ── 전단지 — 바닥에 눌린 채 귀퉁이가 말린 종이 ──────────────
function 전단지지오(r, 손질) {
  const 판 = new THREE.PlaneGeometry(1, 0.72, 5, 4);
  if (손질) 손질(판); // UV 를 아틀라스 칸으로 옮긴다(인덱스가 있을 때가 싸다)
  const g = 판.toNonIndexed();
  판.dispose();
  g.rotateX(-Math.PI / 2); // 바닥에 눕힌다
  const p = g.attributes.position;
  const 말림 = 0.12 + r() * 0.22;
  const 축 = r() < 0.5 ? 1 : -1;
  const 물결 = r() * Math.PI;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    // 한쪽 끝이 들리고(말림), 전체가 살짝 물결친다 — 바닥에 딱 붙은 판은 종이로 안 보인다
    const u = (x * 축 + 0.5) / 1;
    const y = 말림 * u * u + 0.03 * Math.sin(x * 6 + 물결) * (0.4 + u);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ── 종이 칸 번호 ───────────────────────────────────────────
// ★ 여기 있어야 한다. 바로 아래 종류표가 이 값을 읽는다.
//   아래쪽(종이 아틀라스 만드는 곳)에 두면 **모듈을 읽는 순간 죽는다** —
//   const 는 선언 위치 앞에서는 건드릴 수 없다(Cannot access before initialization).
//   빌드는 통과한다. 파일을 실행해 보지 않기 때문이다.
const 종이칸 = { 영수증: 0, 전단지: 1, 신문: 2, 낡은종이: 3 };
const 종이열 = 2;
const 종이행 = 2;

// ── 종류표 ──────────────────────────────────────────────────
//   ※ 병뚜껑은 뺐다 — 너무 작아 무엇인지 안 읽히고 점처럼만 보인다.
// ★ 담배꽁초·콘크리트 조각은 뺐다.
//   꽁초는 4cm 라 무엇인지 안 읽히고 바닥의 점처럼만 보인다.
//   콘크리트 조각은 비밀복도가 이미 '잔해(돌)' 를 따로 뿌리고 있어서 겹쳤다 —
//   같은 것이 두 번 깔리니 바닥이 자잘한 것으로 뒤덮여 어수선해졌다.
//   남긴 것은 전부 **한눈에 무엇인지 읽히는 크기**다.
const 종류들 = [
  { 이름: "캔", 무게: 6 },
  { 이름: "종이컵", 무게: 3 },
  // 종이는 인쇄면이 있어야 종이로 읽힌다 → 아틀라스 칸을 하나씩 쓴다
  { 이름: "영수증", 무게: 3, 종이: 종이칸.영수증, 비율: [0.42, 1.0] },
  { 이름: "전단지", 무게: 2, 종이: 종이칸.전단지, 비율: [1.0, 0.78] },
  { 이름: "신문조각", 무게: 2, 종이: 종이칸.신문, 비율: [1.0, 0.8] },
  { 이름: "낡은종이", 무게: 2, 종이: 종이칸.낡은종이, 비율: [0.85, 1.0] },
  { 이름: "벽돌", 무게: 3 }, // 벽에서 떨어져 나온 조각 — 벽 밑에 쌓인다
  { 이름: "녹슨철판", 무게: 2 },
];
const 뽑기표 = 종류들.flatMap((t, i) => Array(t.무게).fill(i));

const _색 = new THREE.Color();
const _색2 = new THREE.Color();
const _은색 = new THREE.Color("#8b9095"); // 녹이 덜 슨 성한 쇠

// 지오메트리에 정점색을 굽는다.
//   칠 = (x,y,z, 높이비율) => [r,g,b] 또는 null(= 기본색)
function 색굽기(g, 기본, 칠) {
  const p = g.attributes.position;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y;
  const 키 = Math.max(1e-5, g.boundingBox.max.y - y0);
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const 색 = 칠
      ? 칠(p.getX(i), p.getY(i), p.getZ(i), (p.getY(i) - y0) / 키)
      : null;
    const v = 색 ?? 기본;
    c[i * 3] = v[0];
    c[i * 3 + 1] = v[1];
    c[i * 3 + 2] = v[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

// 아틀라스 한 칸으로 UV 를 옮긴다 (캔 라벨 6종을 한 장에 모아 쓰려고)
//   ★ 칸 안쪽으로 조금 물려 넣는다(여백).
//     칸 경계에 딱 붙이면 선형 보간이 **옆 칸 라벨 색을 한 줄 끌어온다** —
//     캔 이음매에 남의 색 실선이 생긴다. 텍셀 두 칸쯤 안으로 들이면 없어진다.
const 칸여백 = 0.012;
function 칸으로(g, 칸, 열, 행) {
  const uv = g.attributes.uv;
  if (!uv) return g;
  const cx = 칸 % 열;
  const cy = Math.floor(칸 / 열);
  const m = 칸여백;
  for (let i = 0; i < uv.count; i++) {
    const u = m + uv.getX(i) * (1 - 2 * m);
    const v = m + uv.getY(i) * (1 - 2 * m);
    uv.setXY(i, (cx + u) / 열, (행 - cy - 1 + v) / 행);
  }
  uv.needsUpdate = true;
  return g;
}

// ── 배치 ────────────────────────────────────────────────────
//   반환: { 캔: geo|null, 잡동: geo|null }
//   캔만 따로 빼는 이유 — 라벨 그림(아틀라스)을 쓰므로 재질이 다르다.
function 잡동사니지오({
  x0, x1, z0, z1, 개수, seed, 밝기, 바닥y, 크기 = 1, 아틀라스열, 아틀라스행,
}) {
  const r = makeRandom(seed);
  const 폭 = x1 - x0;
  const 캔조각 = [];
  const 종이조각 = [];
  const 잡조각 = [];

  for (let i = 0; i < 개수; i++) {
    const t = 종류들[뽑기표[Math.floor(r() * 뽑기표.length)]];

    // ★ 벽 쪽으로 쏠리게. 쓸려 다니는 쓰레기는 벽 밑에 모이고,
    //   가운데가 비면 지나다니는 길이 자연히 생긴다.
    const 벽쪽 = r() < 0.72;
    const u = 벽쪽
      ? (r() < 0.5 ? 0.06 : 0.94) + (r() - 0.5) * 0.16
      : 0.22 + r() * 0.56;
    const x = x0 + Math.min(0.96, Math.max(0.04, u)) * 폭;
    const z = z0 + r() * (z1 - z0);
    const 어둡 = Math.max(0.12, 밝기(z));

    let g;
    let 캔인가 = false;
    let 종이인가 = false;
    let 벽밑 = false; // 벽 밑에 놓이는 물건(벽돌)
    const 왼벽 = x < (x0 + x1) / 2;

    if (t.이름 === "캔") {
      캔인가 = true;
      const 찌 = r();
      // 절반쯤은 제대로 밟혀 있다. 멀쩡한 캔만 굴러다니면 '소품 배치'로 보인다.
      const 세기 = 찌 < 0.28 ? 0.08 + r() * 0.12 : 찌 < 0.72 ? 0.4 + r() * 0.2 : 0.72 + r() * 0.2;
      const 칸 = Math.floor(r() * 캔종류.length);
      g = 돌려서굳히기(캔옆선, 10, (a) => 칸으로(a, 칸, 아틀라스열, 아틀라스행));
      찌그러뜨리기(g, 세기, r);
      g.scale(0.19 * 크기, 0.44 * 크기, 0.19 * 크기);
      // 거의 다 누워 있다. 서 있는 캔은 방금 놓은 것처럼 보여 드물어야 한다.
      if (r() > 0.12) g.rotateX(Math.PI / 2 + (r() - 0.5) * 0.5);
      // 라벨 위에 얹는 색 — 때가 타 조금 어둡고, 개체마다 살짝 다르다
      const v = 어둡 * (0.8 + r() * 0.3);
      색굽기(g, [v, v, v]);
    } else if (t.이름 === "종이컵") {
      const 세기 = 0.35 + r() * 0.5; // 종이컵은 거의 다 찌그러진다
      g = 돌려서굳히기(컵옆선, 10);
      찌그러뜨리기(g, 세기, r);
      g.scale(0.17 * 크기, 0.3 * 크기, 0.17 * 크기);
      if (r() > 0.25) g.rotateX(Math.PI / 2 + (r() - 0.5) * 0.6);
      // 바닥에 남은 커피 자국 — 아래로 갈수록 진하다. 이게 있어야 '쓰던 컵'이다.
      _색.set("#d6cfbe");
      _색2.set("#4a3524");
      색굽기(g, null, (px, py, pz, h) => {
        const 얼룩 = Math.max(0, 1 - h * 2.1) * (0.55 + 0.45 * 자리잡음(px * 9, py * 9, pz * 9));
        const c = _색.clone().lerp(_색2, Math.min(0.85, 얼룩));
        const v = 어둡 * (0.85 + 0.25 * 자리잡음(px * 3, py * 3, pz * 3));
        return [c.r * v, c.g * v, c.b * v];
      });
    } else if (t.종이 !== undefined) {
      // ── 인쇄된 종이 — 영수증·전단지·신문 조각 ──
      종이인가 = true;
      g = 전단지지오(r, (a) => 칸으로(a, t.종이, 종이열, 종이행));
      const [bw, bh] = t.비율;
      const s = (0.34 + r() * 0.18) * 크기;
      g.scale(s * bw, 크기, s * bh);
      g.rotateY(r() * Math.PI * 2);
      // 그림 위에 얹는 밝기만 정점색으로. 때는 아틀라스에 이미 구워 뒀다.
      const v = 어둡 * (0.85 + r() * 0.28);
      색굽기(g, [v, v, v]);
    } else if (t.이름 === "콘크리트조각") {
      g = 콘크리트지오(r);
      const s = (0.1 + r() * 0.13) * 크기;
      g.scale(s, s, s);
      g.rotateY(r() * Math.PI * 2);
      g.rotateZ((r() - 0.5) * 0.7);
      // 깨진 면은 밝은 속살, 오래된 면은 때가 탔다
      _색.set("#7c7f85");
      _색2.set("#4a4d52");
      색굽기(g, null, (px, py, pz, h) => {
        const c = _색.clone().lerp(_색2, 0.25 + (1 - h) * 0.5);
        const 알갱이 = 0.85 + 0.3 * 자리잡음(px * 20, py * 20, pz * 20);
        const v = 어둡 * 알갱이;
        return [c.r * v, c.g * v, c.b * v];
      });
    } else if (t.이름 === "벽돌") {
      // ★ 벽에서 떨어진 것이니 **벽 밑에** 있어야 한다.
      //   바닥 한가운데 벽돌 한 장이 놓여 있으면 '왜 여기 있지'가 된다.
      벽밑 = true;
      const 깨짐 = r() < 0.35 ? 0.15 : 0.5 + r() * 0.5;
      g = 벽돌지오(r, 깨짐);
      const s = (0.5 + r() * 0.22) * 크기;
      g.scale(s, s, s);
      g.rotateZ((r() - 0.5) * 0.35); // 조금 기울어 얹혀 있다
      g.rotateY(r() * Math.PI * 2);
      벽돌칠하기(g, r, 어둡);
    } else if (t.이름 === "녹슨철판") {
      g = 철판지오(r);
      const s = (0.3 + r() * 0.26) * 크기;
      g.scale(s, 크기, s);
      g.rotateY(r() * Math.PI * 2);
      // 녹 — 얼룩덜룩해야 한다. 고른 갈색은 페인트지 녹이 아니다.
      _색.set("#6b4b36"); // 채도를 낮춘 녹
      _색2.set("#2b211a");
      색굽기(g, null, (px, py, pz) => {
        const 녹 = 자리잡음(px * 11, py * 11, pz * 11);
        const 성한데 = Math.max(0, 자리잡음(px * 4, 0, pz * 4) - 0.62) * 2.6;
        const c = _색
          .clone()
          .lerp(_색2, 0.15 + 녹 * 0.55)
          .lerp(_은색, Math.min(0.6, 성한데));
        const v = 어둡;
        return [c.r * v, c.g * v, c.b * v];
      });
    } else {
      // 담배꽁초 — 필터는 연갈색, 태운 끝은 검정. 살짝 꺾여 있다.
      g = 돌려서굳히기(꽁초옆선, 7);
      찌그러뜨리기(g, 0.25 + r() * 0.25, r);
      g.scale(0.028 * 크기, 0.09 * 크기, 0.028 * 크기);
      g.rotateX(Math.PI / 2 + (r() - 0.5) * 0.4);
      g.rotateY(r() * Math.PI * 2);
      _색.set("#cbb27a");
      _색2.set("#17140f");
      색굽기(g, null, (px, py, pz, h) => {
        const c = _색.clone().lerp(_색2, Math.min(1, Math.max(0, (h - 0.45) * 2.6)));
        const v = 어둡;
        return [c.r * v, c.g * v, c.b * v];
      });
    }

    // 밑면이 바닥판에 닿게 올린다(공중에 뜨거나 파묻히지 않게)
    g.computeBoundingBox();
    // 벽 밑에 놓는 것은 벽에 바짝 붙인다 — 떨어져 있으면 '떨어져 나온' 것으로 안 보인다
    const 반폭 = (g.boundingBox.max.x - g.boundingBox.min.x) * 0.5;
    const gx = 벽밑
      ? 왼벽
        ? x0 + 반폭 + 0.04 + r() * 0.25
        : x1 - 반폭 - 0.04 - r() * 0.25
      : x;
    g.translate(gx, -g.boundingBox.min.y + 바닥y + 0.002, z);
    (캔인가 ? 캔조각 : 종이인가 ? 종이조각 : 잡조각).push(g);
  }

  const 합치기 = (조각) => {
    if (!조각.length) return null;
    const m = mergeGeometries(조각, false);
    조각.forEach((g) => g.dispose());
    return m;
  };
  return { 캔: 합치기(캔조각), 종이: 합치기(종이조각), 잡동: 합치기(잡조각) };
}

// ── 물웅덩이 ────────────────────────────────────────────────
//   가장자리를 들쭉날쭉하게 만든다. 정원(正圓)은 물이 아니라 스티커로 보인다.
function 웅덩이지오({ 자리, seed, 바닥y, 밝기 }) {
  const r = makeRandom(seed + 991);
  const 조각 = [];
  for (const { x, z, sx, sz } of 자리) {
    const g = new THREE.CircleGeometry(0.5, 20);
    const p = g.attributes.position;
    for (let i = 1; i < p.count; i++) {
      // 0번은 한가운데라 건드리지 않는다
      const k = 0.72 + 0.5 * 자리잡음(p.getX(i) * 5 + r(), p.getY(i) * 5, 0);
      p.setXY(i, p.getX(i) * k, p.getY(i) * k);
    }
    p.needsUpdate = true;
    g.rotateX(-Math.PI / 2);
    g.scale(sx, 1, sz);
    g.translate(x, 바닥y + 0.01, z);
    const v = Math.max(0.1, 밝기(z));
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      c[i * 3] = 0.06 * v;
      c[i * 3 + 1] = 0.075 * v;
      c[i * 3 + 2] = 0.09 * v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    조각.push(g);
  }
  if (!조각.length) return null;
  const 합 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합;
}

// 웅덩이 자리를 먼저 정한다 — 물방울이 **그 웅덩이 위에서** 떨어져야 한다.
function 웅덩이자리({ x0, x1, z0, z1, 개수, seed }) {
  const r = makeRandom(seed + 4242);
  return Array.from({ length: 개수 }, () => ({
    x: x0 + (0.15 + r() * 0.7) * (x1 - x0),
    z: z0 + r() * (z1 - z0),
    sx: 0.9 + r() * 1.5,
    sz: 0.6 + r() * 1.1,
    // 떨어지는 주기·시작 시각을 저마다 다르게 — 같이 떨어지면 기계처럼 보인다
    주기: 1.6 + r() * 2.2,
    시차: r() * 3,
  }));
}

// ── 떨어지는 물방울 ─────────────────────────────────────────
//   천장 배관에서 새어 웅덩이로 떨어진다. 움직이는 것이 하나라도 있으면
//   같은 공간이 '멈춘 그림'에서 '버려진 채 지금도 흐르는 곳'이 된다.
//   떨어질 때 늘어나고, 닿는 순간 파문이 퍼졌다 사라진다.
function 물방울({ 자리, 천장y, 바닥y, 밝기 }) {
  const 방울ref = useRef([]);
  const 파문ref = useRef([]);
  const 이전u = useRef([]); // 방울마다 지난 프레임 진행도 — '닿는 순간'을 한 번만 잡는다
  useFrame(({ clock, camera }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < 자리.length; i++) {
      const s = 자리[i];
      const 방울 = 방울ref.current[i];
      const 파문 = 파문ref.current[i];
      if (!방울 || !파문) continue;
      const u = ((t + s.시차) % s.주기) / s.주기; // 0~1 한 방울의 일생
      // 낙하(u<0.62)가 끝나 바닥에 닿는 순간(0.62 통과) 딱 한 번, 가까이 있을 때만 소리.
      const 이전 = 이전u.current[i] ?? u;
      if (이전 < 0.62 && u >= 0.62) {
        // 본부실(복도 바깥, x 큰 쪽)에서는 안 들리게 — 복도 안쪽에 있을 때만.
        const 복도쪽 = camera.position.x < s.x + 4;
        const d = Math.hypot(camera.position.x - s.x, camera.position.z - s.z);
        const 최대 = 13; // 이 거리(≈3.9m) 밖이면 안 들린다
        if (복도쪽 && d < 최대) 소리재생("물방울", { 볼륨: 0.5 * (1 - d / 최대) });
      }
      이전u.current[i] = u;
      const 낙하 = Math.min(1, u / 0.62); // 앞 62% 는 떨어지는 시간
      if (u < 0.62) {
        방울.visible = true;
        // 중력 — 등속이 아니라 아래로 갈수록 빨라져야 물처럼 보인다
        const h = 낙하 * 낙하;
        방울.position.y = 천장y + (바닥y - 천장y) * h;
        // 빨라질수록 길게 늘어난다
        방울.scale.set(1, 1 + h * 2.2, 1);
      } else {
        방울.visible = false;
      }
      // 파문 — 닿은 뒤 퍼지며 사라진다
      const p = (u - 0.62) / 0.38;
      if (u >= 0.62) {
        파문.visible = true;
        const k = 0.25 + p * 1.4;
        파문.scale.set(k * s.sx, 1, k * s.sz);
        파문.material.opacity = 0.45 * (1 - p) * (1 - p);
      } else 파문.visible = false;
    }
  });

  return (
    <group>
      {자리.map((s, i) => {
        const v = Math.max(0.15, 밝기(s.z));
        return (
          <group key={`drip${i}`}>
            <mesh
              ref={(m) => (방울ref.current[i] = m)}
              position={[s.x, 천장y, s.z]}
              visible={false}
            >
              <sphereGeometry args={[0.035, 7, 5]} />
              <meshBasicMaterial
                color={new THREE.Color(0.45 * v, 0.55 * v, 0.62 * v)}
                toneMapped={false}
              />
            </mesh>
            <mesh
              ref={(m) => (파문ref.current[i] = m)}
              position={[s.x, 바닥y + 0.014, s.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              visible={false}
            >
              <ringGeometry args={[0.34, 0.5, 20]} />
              <meshBasicMaterial
                color={new THREE.Color(0.5 * v, 0.6 * v, 0.68 * v)}
                transparent
                opacity={0}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ── 종이 아틀라스 — 영수증 · 전단지 · 신문 조각 ─────────────
// [왜 글씨를 그려 넣나]
//   백지는 종이로 안 보인다. 바닥에 떨어진 종이가 종이로 읽히는 건
//   **인쇄된 줄** 때문이다. 읽으라고 넣는 게 아니라 '글씨가 있다'가 보이면 된다.
//   그래서 실제 글자를 몇 개만 쓰고 나머지는 줄로 흉내 낸다 — 멀리서는 똑같고
//   가까이서는 '영수증이구나' 가 온다.

const 폰트 = "'Malgun Gothic', system-ui, sans-serif";

function 줄긋기(g, x, y, w, h, 색) {
  g.fillStyle = 색;
  g.fillRect(x, y, w, h);
}

function 종이아틀라스() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = 종이열 * S;
  c.height = 종이행 * S;
  const g = c.getContext("2d");
  const r = makeRandom(31337);
  const 칸 = (i) => [(i % 종이열) * S, Math.floor(i / 종이열) * S];

  // ① 영수증 — 감열지. 위에 상호, 점선, 품목 줄, 합계.
  {
    const [ox, oy] = 칸(종이칸.영수증);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#e8e4d9";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#3a3630";
    g.textAlign = "center";
    g.font = `700 26px ${폰트}`;
    g.fillText("나주역 매점", S / 2, 34);
    g.font = `16px ${폰트}`;
    g.fillText("TEL 061-330-****", S / 2, 56);
    for (let i = 0; i < 2; i++) 줄긋기(g, 18, 70 + i * 6, S - 36, 2, "#8d887c");
    g.textAlign = "left";
    g.font = `15px ${폰트}`;
    let y = 96;
    for (const [이름, 값] of [
      ["캔커피", "1,200"], ["생수", "900"], ["샌드위치", "3,500"],
      ["담배", "4,500"], ["봉투", "100"],
    ]) {
      g.fillText(이름, 22, y);
      g.textAlign = "right";
      g.fillText(값, S - 22, y);
      g.textAlign = "left";
      y += 22;
    }
    줄긋기(g, 18, y - 8, S - 36, 2, "#8d887c");
    g.font = `700 19px ${폰트}`;
    g.fillText("합계", 22, y + 20);
    g.textAlign = "right";
    g.fillText("10,200", S - 22, y + 20);
    // 아래쪽 바코드 흉내
    for (let i = 0; i < 40; i++)
      줄긋기(g, 30 + i * 5, S - 40, 1 + r() * 3, 26, "#2c2924");
    g.restore();
  }

  // ② 전단지 — 큰 제목 띠 + 본문 줄 + 그림 자리
  {
    const [ox, oy] = 칸(종이칸.전단지);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#ddd7c6";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#8e3b2f";
    g.fillRect(0, 18, S, 52);
    g.fillStyle = "#f4efe2";
    g.textAlign = "center";
    g.font = `800 34px ${폰트}`;
    g.fillText("임대 문의", S / 2, 54);
    g.fillStyle = "#c9c2b0";
    g.fillRect(20, 86, 96, 74); // 그림 자리
    g.fillStyle = "#4a453b";
    for (let i = 0; i < 6; i++) 줄긋기(g, 128, 92 + i * 13, 108 - r() * 26, 5, "#5a5449");
    for (let i = 0; i < 5; i++) 줄긋기(g, 20, 176 + i * 14, S - 40 - r() * 60, 5, "#5a5449");
    g.restore();
  }

  // ③ 신문 조각 — 단이 나뉜 촘촘한 줄 + 사진
  {
    const [ox, oy] = 칸(종이칸.신문);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#d8d3c3";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#2f2b25";
    g.textAlign = "left";
    g.font = `800 24px ${폰트}`;
    g.fillText("폐선 구간 정비", 16, 34);
    줄긋기(g, 14, 44, S - 28, 2, "#4a453b");
    g.fillStyle = "#b9b3a2";
    g.fillRect(14, 54, 104, 66); // 사진
    for (let 단 = 0; 단 < 2; 단++) {
      const x = 14 + 단 * 118;
      const y0 = 단 === 0 ? 128 : 54;
      for (let i = 0; i < (단 === 0 ? 8 : 14); i++)
        줄긋기(g, x, y0 + i * 11, 104 - r() * 22, 4, "#544f45");
    }
    g.restore();
  }

  // ④ 낡은 종이 — 거의 지워진 줄 몇 개
  {
    const [ox, oy] = 칸(종이칸.낡은종이);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = "#cfc8b6";
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++)
      줄긋기(g, 24 + r() * 20, 40 + i * 22, 120 + r() * 80, 4, "#6b6558");
    g.restore();
  }

  // 공통 때 — 커피 얼룩·먼지. 새 종이가 바닥에 있으면 어색하다.
  g.globalCompositeOperation = "multiply";
  for (let i = 0; i < 70; i++) {
    const R = 8 + r() * 46;
    g.fillStyle = `rgba(${120 + r() * 50 | 0},${100 + r() * 40 | 0},${70 + r() * 30 | 0},${0.08 + r() * 0.22})`;
    g.beginPath();
    g.arc(r() * c.width, r() * c.height, R, 0, 7);
    g.fill();
  }
  g.fillStyle = "rgba(150,145,132,0.35)";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── 캔 라벨 아틀라스 ────────────────────────────────────────
//   6종을 한 장에 모으고 **때를 입힌다.** 새 캔 그림 그대로면
//   갓 뽑은 캔이 바닥에 놓인 꼴이라 어색하다.
const 아틀라스열 = 3;
const 아틀라스행 = 2;
function 캔아틀라스() {
  const 칸W = 256;
  const 칸H = 128;
  const c = document.createElement("canvas");
  c.width = 아틀라스열 * 칸W;
  c.height = 아틀라스행 * 칸H;
  const g = c.getContext("2d");
  캔종류.forEach((t, i) => {
    const cx = (i % 아틀라스열) * 칸W;
    const cy = Math.floor(i / 아틀라스열) * 칸H;
    캔라벨그리기(g, cx, cy, 칸W, 칸H, t);
  });
  // 때 — 색을 죽이고, 긁힌 자국과 얼룩을 얹는다
  const rnd = makeRandom(20260910);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = "rgba(150,148,140,0.55)";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 260; i++) {
    const a = 0.05 + rnd() * 0.18;
    g.fillStyle = `rgba(70,66,58,${a})`;
    const w = 4 + rnd() * 40;
    g.fillRect(rnd() * c.width, rnd() * c.height, w, 1 + rnd() * 5);
  }
  g.globalCompositeOperation = "source-over";
  // 긁혀 벗겨진 금속 — 밝은 실선
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(205,208,212,${0.15 + rnd() * 0.35})`;
    g.lineWidth = 0.6 + rnd() * 1.4;
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 34, y + (rnd() - 0.5) * 8);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ═══════════════════════════════════════════════════════════════
//  부식 자국 — 바닥·벽에 번진 녹과 물때
// ═══════════════════════════════════════════════════════════════
// [왜 필요한가]
//   벽·바닥 질감은 한 장을 되풀이해 깐다. 아무리 잘 그려도 '고르게 낡은 면'이
//   되어, 가까이 가면 무늬가 반복되는 게 보인다.
//   실제로 낡은 공간은 **고르게** 낡지 않는다 — 물이 닿은 자리, 쇠가 박힌 자리,
//   배관 밑처럼 **한 군데씩** 썩어 들어간다. 그 얼룩덜룩함이 세월을 만든다.
//
// [어떻게 만드나]
//   판을 하나 덧대고 가운데는 녹색, 가장자리는 **바탕면 색**으로 물들인다.
//   가장자리가 바탕과 같은 색이라 테두리 없이 스르륵 번져 보인다.
//   원판을 그대로 쓰면 동그란 스티커라, 반지름을 들쭉날쭉하게 흔든다.
//
// [벽에 흘러내린 자국]
//   물이 새면 아래로 흐른다. 그래서 벽 자국은 위가 좁고 아래로 길게 끌린다.
//   이게 있고 없고가 '더러운 벽'과 '녹슨 벽'을 가른다.

// ★ 채도를 낮췄다. 주황빛이 세면 녹이 아니라 '칠한 것'으로 보이고,
//   어두운 복도에서 그 부분만 색이 튄다. 흙빛에 가깝게 눌렀다.
const 녹색조 = ["#5c4133", "#67493a", "#4a382d", "#3a2d25"];

function 얼룩판(r, { 세로늘림 = 1 } = {}) {
  const g = new THREE.CircleGeometry(0.5, 16);
  const p = g.attributes.position;
  const 씨 = r() * 9;
  for (let i = 1; i < p.count; i++) {
    // 0번은 한가운데라 안 건드린다
    const k = 0.55 + 0.75 * 자리잡음(p.getX(i) * 6 + 씨, p.getY(i) * 6, 씨);
    p.setXY(i, p.getX(i) * k, p.getY(i) * k * 세로늘림);
  }
  p.needsUpdate = true;
  return g;
}

// 얼룩 하나에 색을 굽는다 — 가운데는 녹, 가장자리는 바탕색(그래야 번져 보인다)
function 얼룩색(g, 녹, 바탕, 밝) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // 삼각부채라 0번이 중심, 나머지가 테두리다
    const 중심 = i === 0 ? 1 : 0;
    const 섞 = 중심 ? 0 : 1;
    _색.copy(녹).lerp(바탕, 섞).multiplyScalar(밝);
    c[i * 3] = _색.r;
    c[i * 3 + 1] = _색.g;
    c[i * 3 + 2] = _색.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

// ── 금 — 벽을 타고 내려간 균열 ──────────────────────────────
//   한 줄로 곧게 그으면 '선을 그린 것'이다. 마디마다 방향이 꺾이고
//   아래로 갈수록 가늘어져야 갈라진 것으로 보인다.
function 금조각(r, 색, 밝) {
  const 마디 = 3 + Math.floor(r() * 3);
  const 것 = [];
  let x = 0;
  let y = 0;
  let 각 = -Math.PI / 2 + (r() - 0.5) * 0.5; // 대체로 아래로
  let 폭 = 0.045 + r() * 0.03;
  for (let i = 0; i < 마디; i++) {
    const 길이 = 0.18 + r() * 0.3;
    const g = new THREE.PlaneGeometry(1, 1);
    g.scale(길이, 폭, 1);
    g.rotateZ(각);
    g.translate(x + (Math.cos(각) * 길이) / 2, y + (Math.sin(각) * 길이) / 2, 0);
    const p = g.attributes.position;
    const c = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      c[k * 3] = 색.r * 밝;
      c[k * 3 + 1] = 색.g * 밝;
      c[k * 3 + 2] = 색.b * 밝;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    것.push(g);
    x += Math.cos(각) * 길이;
    y += Math.sin(각) * 길이;
    각 += (r() - 0.5) * 0.9;
    폭 *= 0.72; // 끝으로 갈수록 가늘어진다
  }
  return 것;
}

function 부식지오({
  x0, x1, z0, z1, 바닥y, 벽높이, 개수, seed, 밝기, 바닥색, 벽색, 문z, 문폭, 크기,
}) {
  const r = makeRandom(seed + 777);
  const 조각 = [];
  const 바탕바닥 = new THREE.Color(바닥색);
  const 바탕벽 = new THREE.Color(벽색);
  const 녹 = new THREE.Color();

  // ── 바닥 ── 벽 밑과 웅덩이 언저리가 먼저 썩는다
  for (let i = 0; i < 개수.바닥; i++) {
    const 벽쪽 = r() < 0.75;
    const u = 벽쪽 ? (r() < 0.5 ? 0.04 : 0.96) + (r() - 0.5) * 0.22 : 0.2 + r() * 0.6;
    const x = x0 + Math.min(0.99, Math.max(0.01, u)) * (x1 - x0);
    const z = z0 + r() * (z1 - z0);
    const g = 얼룩판(r);
    g.rotateX(-Math.PI / 2);
    const s = (0.5 + r() * 1.5) * 크기;
    g.scale(s, 1, s * (0.7 + r() * 0.8));
    g.rotateY(r() * Math.PI);
    g.translate(x, 바닥y + 0.004, z);
    녹.set(녹색조[Math.floor(r() * 녹색조.length)]);
    얼룩색(g, 녹, 바탕바닥, Math.max(0.12, 밝기(z)));
    조각.push(g);
  }

  // ── 벽 ── 아래쪽(물이 스며오르는 자리)에 몰리고, 아래로 흘러내린다
  for (let i = 0; i < 개수.벽; i++) {
    const 왼쪽 = r() < 0.5;
    const z = z0 + r() * (z1 - z0);
    // 방으로 통하는 구멍 자리는 벽이 없다 → 거기엔 안 붙인다
    if (!왼쪽 && Math.abs(z - 문z) < 문폭 / 2 + 0.3) continue;
    const 흘림 = r() < 0.45;
    const g = 얼룩판(r, { 세로늘림: 흘림 ? 2.6 + r() * 2.2 : 1 });
    // 아래에 몰리게 — 제곱을 쓰면 바닥 가까이로 쏠린다
    const h = Math.pow(r(), 1.8) * 벽높이 * 0.7 + 0.15;
    const s = (0.45 + r() * 1.2) * 크기;
    g.scale(s, s, 1);
    // 흘러내린 자국은 아래로 끌리므로 중심을 위로 올려 잡는다
    g.translate(0, 흘림 ? -s * 0.6 : 0, 0);
    if (왼쪽) {
      g.rotateY(Math.PI / 2);
      g.translate(x0 + 0.03, h, z);
    } else {
      g.rotateY(-Math.PI / 2);
      g.translate(x1 - 0.03, h, z);
    }
    녹.set(녹색조[Math.floor(r() * 녹색조.length)]);
    얼룩색(g, 녹, 바탕벽, Math.max(0.12, 밝기(z)));
    조각.push(g);
  }

  // ── 금 ── 벽을 타고 내려간 균열 (얇아서 얼룩과 같이 눕는다)
  const 금색 = new THREE.Color("#1e2024");
  const 벽에붙이기 = (조각들, 왼쪽, h, z, 담을곳) => {
    for (const g of 조각들) {
      if (왼쪽) {
        g.rotateY(Math.PI / 2);
        g.translate(x0 + 0.035, h, z);
      } else {
        g.rotateY(-Math.PI / 2);
        g.translate(x1 - 0.035, h, z);
      }
      담을곳.push(g);
    }
  };
  for (let i = 0; i < 개수.금; i++) {
    const 왼쪽 = r() < 0.5;
    const z = z0 + r() * (z1 - z0);
    if (!왼쪽 && Math.abs(z - 문z) < 문폭 / 2 + 0.3) continue;
    const h = 벽높이 * (0.35 + r() * 0.5);
    const 것 = 금조각(r, 금색, Math.max(0.12, 밝기(z)));
    것.forEach((g) => g.scale(크기, 크기, 1));
    벽에붙이기(것, 왼쪽, h, z, 조각);
  }

  if (!조각.length) return null;
  const 합 = mergeGeometries(조각, false);
  조각.forEach((g) => g.dispose());
  return 합;
}

/** 바닥·벽에 번진 부식 자국. 벽·바닥 면 바로 위에 덧대는 얇은 판들이다. */
export function 복도부식({
  x0, x1, z0, z1,
  바닥y = 0.01,
  벽높이 = 8,
  바닥개수 = 16,
  벽개수 = 26,
  금개수 = 8,
  크기 = 1,
  문z = -4,
  문폭 = 4.4,
  바닥색 = "#3a3d42",
  벽색 = "#525b69",
  seed = 4711,
  밝기 = () => 1,
}) {
  const 지오 = useMemo(
    () =>
      부식지오({
        x0, x1, z0, z1, 바닥y, 벽높이,
        개수: { 바닥: 바닥개수, 벽: 벽개수, 금: 금개수 },
        seed, 밝기, 바닥색, 벽색, 문z, 문폭, 크기,
      }),
    // ★ 밝기는 **한 번만 만들어 넘겨 주는 함수**다(App 의 복도밝기).
    //   예전에는 자리마다 새 함수를 만들어 넘겨서, 의존성에 넣으면 매 렌더
    //   지오를 다시 만들었다 — 그래서 빼 놨고, 그 탓에 밝기 슬라이더를
    //   움직여도 여기만 안 변했다. 이제 넣어도 안전하고, 슬라이더도 먹는다.
    [x0, x1, z0, z1, 바닥y, 벽높이, 바닥개수, 벽개수, 금개수,
     seed, 밝기, 바닥색, 벽색, 문z, 문폭, 크기],
  );
  useEffect(() => () => 지오?.dispose(), [지오]);
  if (!지오) return null;
  return (
    <mesh geometry={지오}>
      {/* 벽·바닥 면 바로 위에 겹쳐 그린다.
             polygonOffset 이 없으면 두 면의 깊이값이 엎치락뒤치락해 깜빡인다.
             외곽선은 두르지 않는다 — 얼룩에 테를 그으면 스티커가 된다. */}
      <meshToonMaterial
        vertexColors
        color="#ffffff"
        gradientMap={TOON_GRADIENT}
        transparent
        /* 0.72 → 0.62. 얼룩이 진하면 복도 전체가 눌린 것처럼 어두워 보인다 */
        opacity={0.62}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

export function 복도잡동사니({
  x0,
  x1,
  z0,
  z1,
  개수,
  웅덩이 = 3,
  바닥y = 0.01, // 복도 바닥판이 깔린 높이
  천장y = 7, // 물방울이 시작하는 높이(천장 배관)
  // ★ 실물 치수(1 유닛 ≈ 0.30m)대로 두면 넓은 복도에서 너무 작게 읽힌다.
  //   스타일 게임은 바닥 소품을 실물보다 조금 키워야 눈에 들어온다.
  크기 = 1.45,
  seed = 4711,
  밝기 = () => 1,
  선,
}) {
  const 실개수 = 개수 ?? Math.round(Math.min(90, Math.max(8, (z1 - z0) * 0.55)));
  const 자리 = useMemo(
    () => 웅덩이자리({ x0, x1, z0, z1, 개수: 웅덩이, seed }),
    [x0, x1, z0, z1, 웅덩이, seed],
  );
  const { 캔: 캔지오, 종이: 종이지오, 잡동 } = useMemo(
    () =>
      잡동사니지오({
        x0, x1, z0, z1,
        개수: 실개수, seed, 밝기, 바닥y, 크기, 아틀라스열, 아틀라스행,
      }),
    // ★ 밝기는 App 이 한 번만 만들어 넘기는 함수라 의존성에 넣어도 안전하다
    //   (위 복도부식의 설명과 같은 이유).
    [x0, x1, z0, z1, 실개수, seed, 밝기, 바닥y, 크기],
  );
  const 물 = useMemo(
    () => 웅덩이지오({ 자리, seed, 바닥y, 밝기 }),
    [자리, seed, 바닥y, 밝기],
  );
  const 라벨 = useMemo(() => 캔아틀라스(), []);
  const 종이그림 = useMemo(() => 종이아틀라스(), []);
  useEffect(
    () => () => {
      캔지오?.dispose();
      종이지오?.dispose();
      잡동?.dispose();
      물?.dispose();
      라벨?.dispose();
      종이그림?.dispose();
    },
    [캔지오, 종이지오, 잡동, 물, 라벨, 종이그림],
  );

  return (
    <group>
      {캔지오 && (
        <mesh geometry={캔지오} castShadow receiveShadow>
          {/* 라벨 그림 × 정점색(때·깊이 감광) */}
          <meshToonMaterial
            map={라벨}
            vertexColors
            gradientMap={TOON_GRADIENT}
          />
          <만화선 선={선} />
        </mesh>
      )}
      {종이지오 && (
        <mesh geometry={종이지오} castShadow receiveShadow>
          {/* 인쇄면 그림 × 정점색(밝기). 종이는 뒤에서도 보여야 한다 —
                 바닥에 붙어 있어도 귀퉁이가 말려 뒷면이 드러난다. */}
          <meshToonMaterial
            map={종이그림}
            vertexColors
            gradientMap={TOON_GRADIENT}
            side={THREE.DoubleSide}
          />
          <만화선 선={선} />
        </mesh>
      )}
      {잡동 && (
        <mesh geometry={잡동} castShadow receiveShadow>
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
      <물방울 자리={자리} 천장y={천장y} 바닥y={바닥y} 밝기={밝기} />
    </group>
  );
}
