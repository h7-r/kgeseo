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

// ── 전단지 — 바닥에 눌린 채 귀퉁이가 말린 종이 ──────────────
function 전단지지오(r) {
  const 판 = new THREE.PlaneGeometry(1, 0.72, 5, 4);
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

// ── 종류표 ──────────────────────────────────────────────────
//   ※ 병뚜껑은 뺐다 — 너무 작아 무엇인지 안 읽히고 점처럼만 보인다.
const 종류들 = [
  { 이름: "캔", 무게: 6, 텍스처: true },
  { 이름: "종이컵", 무게: 4 },
  { 이름: "전단지", 무게: 4 },
  { 이름: "콘크리트조각", 무게: 4 },
  { 이름: "담배꽁초", 무게: 3 },
];
const 뽑기표 = 종류들.flatMap((t, i) => Array(t.무게).fill(i));

const _색 = new THREE.Color();
const _색2 = new THREE.Color();

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
function 잡동사니지오({ x0, x1, z0, z1, 개수, seed, 밝기, 바닥y, 아틀라스열, 아틀라스행 }) {
  const r = makeRandom(seed);
  const 폭 = x1 - x0;
  const 캔조각 = [];
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

    if (t.이름 === "캔") {
      캔인가 = true;
      const 찌 = r();
      // 절반쯤은 제대로 밟혀 있다. 멀쩡한 캔만 굴러다니면 '소품 배치'로 보인다.
      const 세기 = 찌 < 0.28 ? 0.08 + r() * 0.12 : 찌 < 0.72 ? 0.4 + r() * 0.2 : 0.72 + r() * 0.2;
      const 칸 = Math.floor(r() * 캔종류.length);
      g = 돌려서굳히기(캔옆선, 10, (a) => 칸으로(a, 칸, 아틀라스열, 아틀라스행));
      찌그러뜨리기(g, 세기, r);
      g.scale(0.19, 0.44, 0.19);
      // 거의 다 누워 있다. 서 있는 캔은 방금 놓은 것처럼 보여 드물어야 한다.
      if (r() > 0.12) g.rotateX(Math.PI / 2 + (r() - 0.5) * 0.5);
      // 라벨 위에 얹는 색 — 때가 타 조금 어둡고, 개체마다 살짝 다르다
      const v = 어둡 * (0.8 + r() * 0.3);
      색굽기(g, [v, v, v]);
    } else if (t.이름 === "종이컵") {
      const 세기 = 0.35 + r() * 0.5; // 종이컵은 거의 다 찌그러진다
      g = 돌려서굳히기(컵옆선, 10);
      찌그러뜨리기(g, 세기, r);
      g.scale(0.17, 0.3, 0.17);
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
    } else if (t.이름 === "전단지") {
      g = 전단지지오(r);
      g.scale(0.28 + r() * 0.16, 1, 0.28 + r() * 0.14);
      g.rotateY(r() * Math.PI * 2);
      // 인쇄면 — 위쪽에 제목 띠, 아래쪽에 본문 줄. 백지는 종이로 안 보인다.
      _색.set(r() < 0.5 ? "#c9c3b2" : "#d2ccbb");
      _색2.set("#4d4738");
      색굽기(g, null, (px, py, pz) => {
        const 인쇄 =
          pz > 0.18 ? 0.55 : pz > -0.05 && Math.abs((pz * 40) % 4) < 1.6 ? 0.32 : 0;
        const 때 = 0.75 + 0.35 * 자리잡음(px * 7, pz * 7, 0);
        const c = _색.clone().lerp(_색2, 인쇄);
        const v = 어둡 * 때;
        return [c.r * v, c.g * v, c.b * v];
      });
    } else if (t.이름 === "콘크리트조각") {
      g = 콘크리트지오(r);
      const s = 0.1 + r() * 0.13;
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
    } else {
      // 담배꽁초 — 필터는 연갈색, 태운 끝은 검정. 살짝 꺾여 있다.
      g = 돌려서굳히기(꽁초옆선, 7);
      찌그러뜨리기(g, 0.25 + r() * 0.25, r);
      g.scale(0.028, 0.09, 0.028);
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
    g.translate(x, -g.boundingBox.min.y + 바닥y + 0.002, z);
    (캔인가 ? 캔조각 : 잡조각).push(g);
  }

  const 합치기 = (조각) => {
    if (!조각.length) return null;
    const m = mergeGeometries(조각, false);
    조각.forEach((g) => g.dispose());
    return m;
  };
  return { 캔: 합치기(캔조각), 잡동: 합치기(잡조각) };
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
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < 자리.length; i++) {
      const s = 자리[i];
      const 방울 = 방울ref.current[i];
      const 파문 = 파문ref.current[i];
      if (!방울 || !파문) continue;
      const u = ((t + s.시차) % s.주기) / s.주기; // 0~1 한 방울의 일생
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

export function 복도잡동사니({
  x0,
  x1,
  z0,
  z1,
  개수,
  웅덩이 = 3,
  바닥y = 0.01, // 복도 바닥판이 깔린 높이
  천장y = 7, // 물방울이 시작하는 높이(천장 배관)
  seed = 4711,
  밝기 = () => 1,
  선,
}) {
  const 실개수 = 개수 ?? Math.round(Math.min(90, Math.max(8, (z1 - z0) * 0.55)));
  const 자리 = useMemo(
    () => 웅덩이자리({ x0, x1, z0, z1, 개수: 웅덩이, seed }),
    [x0, x1, z0, z1, 웅덩이, seed],
  );
  const { 캔: 캔지오, 잡동 } = useMemo(
    () =>
      잡동사니지오({
        x0, x1, z0, z1,
        개수: 실개수, seed, 밝기, 바닥y, 아틀라스열, 아틀라스행,
      }),
    // 밝기는 매 렌더 새 함수라 의존성에 넣으면 계속 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x0, x1, z0, z1, 실개수, seed, 바닥y],
  );
  const 물 = useMemo(
    () => 웅덩이지오({ 자리, seed, 바닥y, 밝기 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [자리, seed, 바닥y],
  );
  const 라벨 = useMemo(() => 캔아틀라스(), []);
  useEffect(
    () => () => {
      캔지오?.dispose();
      잡동?.dispose();
      물?.dispose();
      라벨?.dispose();
    },
    [캔지오, 잡동, 물, 라벨],
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
