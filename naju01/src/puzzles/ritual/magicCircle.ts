/**
 * 기우제 마법진 — 소반을 가운데 두고 돌탑 여섯이 둘레에 선다.
 * 처음엔 돌탑 자리(홈)만 새겨져 있고 마법진은 보이지 않는다. 돌탑이 맞으면 그 홈만 빛나고,
 * 여섯이 다 맞으면 겹원 · 한자 띠 · 곁원 · 육망성 · 안쪽 육각 · 소반 둘레 원 · 살이 차례로 그려진다.
 * 선은 땅에 붙은 가는 띠다. 꼭짓점마다 「그려지는 차례(aReveal, 0~1)」를 실어 두고 셰이더가 진행만큼만 밝힌다.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { M, groundY } from "../fishTrap/shared";

/** 마법진 가운데 = 소반(씬5 소반 자리, 미터) */
export const CIRCLE_CENTER = { x: 45.0, z: 37.0 };
/** 돌탑이 서는 원의 반지름(미터) — 금줄 기둥(42.7 · 47.3)과 0.8 m 떨어진다 */
export const CIRCLE_RADIUS = 2.2;
/** 첫 자리 각(라디안) — 30° 돌려 소반 앞뒤가 아니라 비스듬히 여섯을 둔다 */
const FIRST_ANGLE = Math.PI / 6;

/** 홈 눈금 수 — 자리마다 다르다. 그 수만큼 돌을 쌓은 돌탑이 맞는 짝이다 */
export const NODE_NOTCHES = [4, 2, 6, 3, 7, 5];

export const NODES = NODE_NOTCHES.map((notches, k) => {
  const angle = FIRST_ANGLE + (k * Math.PI) / 3;
  return {
    notches,
    x: CIRCLE_CENTER.x + Math.sin(angle) * CIRCLE_RADIUS,
    z: CIRCLE_CENTER.z + Math.cos(angle) * CIRCLE_RADIUS,
  };
});

/** 홈 원 반지름(미터) — 돌탑 밑동보다 조금 크게 */
export const NODE_RING_RADIUS = 0.36;

const LINE_WIDTH = 0.025;
/** 땅에서 띄우는 높이(미터) — 소반 앞을 지나는 흙길(땅.길)이 땅보다 0.1 m 높아 그 위로 올린다 */
const LIFT = 0.12;

type Point = [number, number];

/** 미터 xz 점들을 잇는 땅 위 띠. reveal 은 첫 점 → 끝 점 사이의 그려지는 차례 */
function ribbon(points: Point[], reveal: [number, number], width = LINE_WIDTH) {
  const positions: number[] = [];
  const reveals: number[] = [];
  const indices: number[] = [];
  points.forEach(([x, z], i) => {
    const [px, pz] = points[Math.max(0, i - 1)];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const tx = nx - px;
    const tz = nz - pz;
    const length = Math.hypot(tx, tz) || 1;
    const ox = (-tz / length) * (width / 2);
    const oz = (tx / length) * (width / 2);
    const y = groundY(x, z) + LIFT;
    positions.push((x + ox) * M, y * M, (z + oz) * M, (x - ox) * M, y * M, (z - oz) * M);
    const t = reveal[0] + (reveal[1] - reveal[0]) * (i / (points.length - 1));
    reveals.push(t, t);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aReveal", new THREE.Float32BufferAttribute(reveals, 1));
  geometry.setIndex(indices);
  return geometry;
}

/** 원호(미터) — from → to 각을 잘게 나눈 점들 */
function arc(cx: number, cz: number, radius: number, from: number, to: number, steps = 48): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = from + ((to - from) * i) / steps;
    return [cx + Math.sin(angle) * radius, cz + Math.cos(angle) * radius];
  });
}

function segment(a: Point, b: Point, steps = 24): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
}

/** 한자 띠 글귀 — 기우제 축문에서 따온 말. 둘레를 한 바퀴 돈다 */
export const OUTER_HANJA = "祈雨祭天 龍王降臨 雲起風行 雷動電閃 甘雨普降 江河滿溢 萬物復生 天地感應 ";
export const INNER_HANJA = "雨 風 雲 雷 水 龍 天 地 ";

/** 바깥 · 안쪽 한자 띠(미터) — 겹원 사이에 들어간다 */
export const HANJA_BANDS = [
  { text: OUTER_HANJA, inner: CIRCLE_RADIUS + 0.19, outer: CIRCLE_RADIUS + 0.47, reveal: [0.12, 0.32] as [number, number] },
  { text: INNER_HANJA, inner: 0.88, outer: 1.03, reveal: [0.58, 0.7] as [number, number] },
];

/** 한자를 한 줄로 그린 글자판 — 흰 글자, 바탕은 비운다. 한 칸이 한 글자 */
export function makeHanjaTexture(text: string) {
  const cell = 96;
  const canvas = document.createElement("canvas");
  canvas.width = cell * text.length;
  canvas.height = cell;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  // 명조 계열 — 붓글씨 같은 획이 마법진에 어울린다. 없으면 시스템 명조 · 세리프로
  context.font = `600 ${cell * 0.78}px "AppleMyungjo","Nanum Myeongjo","Noto Serif KR","Noto Serif CJK KR","Songti SC",serif`;
  [...text].forEach((char, i) => context.fillText(char, cell * (i + 0.5), cell * 0.54));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * 한자 띠 — inner ~ outer 사이 고리. u 는 둘레(글자 줄 방향), v 는 안 → 바깥(글자 아래 → 위).
 * 글자 차례대로 그려지게 aReveal 을 둘레를 따라 싣는다.
 */
export function buildHanjaBand(inner: number, outer: number, characters: number, reveal: [number, number]) {
  const { x: cx, z: cz } = CIRCLE_CENTER;
  const segments = characters * 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const reveals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    // 위에서 내려다볼 때 시계 방향으로 읽히게 각을 거꾸로 돈다
    const angle = -u * Math.PI * 2;
    for (const [radius, v] of [
      [inner, 0],
      [outer, 1],
    ]) {
      const x = cx + Math.sin(angle) * radius;
      const z = cz + Math.cos(angle) * radius;
      positions.push(x * M, (groundY(x, z) + LIFT) * M, z * M);
      uvs.push(u, v);
      reveals.push(reveal[0] + (reveal[1] - reveal[0]) * u);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("aReveal", new THREE.Float32BufferAttribute(reveals, 1));
  geometry.setIndex(indices);
  return geometry;
}

/** 마법진 본선 — 돌탑이 다 맞은 뒤 바깥에서 안으로 차례대로 그려진다 */
export function buildCircleLines() {
  const { x: cx, z: cz } = CIRCLE_CENTER;
  const R = CIRCLE_RADIUS;
  const node = (k: number): Point => [NODES[k % 6].x, NODES[k % 6].z];
  const angleOf = (k: number) => FIRST_ANGLE + (k * Math.PI) / 3;
  const ring = (radius: number, reveal: [number, number], x = cx, z = cz, steps = 96) =>
    ribbon(arc(x, z, radius, 0, Math.PI * 2, steps), reveal);
  const parts: THREE.BufferGeometry[] = [];

  // ① 돌탑에서 돌탑으로 — 바깥 원이 여섯 갈래로 동시에 이어지고, 홈마다 곁원이 둘린다
  for (let k = 0; k < 6; k++) parts.push(ribbon(arc(cx, cz, R, angleOf(k), angleOf(k + 1), 24), [0, 0.18]));
  for (let k = 0; k < 6; k++) parts.push(ring(0.55, [0.02, 0.16], NODES[k].x, NODES[k].z, 40));
  // ② 바깥 겹원 둘 — 사이에 한자 띠(buildHanjaBand)가 들어간다
  parts.push(ring(R + 0.16, [0.06, 0.24], cx, cz, 160));
  parts.push(ring(R + 0.5, [0.1, 0.3], cx, cz, 180));
  // ③ 홈 사이 곁원 — 바깥 원 위, 홈과 홈 가운데에 작은 겹원
  for (let k = 0; k < 6; k++) {
    const angle = angleOf(k) + Math.PI / 6;
    const x = cx + Math.sin(angle) * R;
    const z = cz + Math.cos(angle) * R;
    parts.push(ring(0.26, [0.18, 0.3], x, z, 32), ring(0.14, [0.22, 0.32], x, z, 24));
  }
  // ④ 육망성 — 삼각형 둘
  for (let k = 0; k < 6; k++) parts.push(ribbon(segment(node(k), node(k + 2)), [0.3, 0.48]));
  // ⑤ 안쪽 육각 — 육망성 두 삼각형이 엇갈리는 점을 잇는다(반지름 R/√3, 홈 사이 각)
  const innerR = R / Math.sqrt(3);
  const inner = (k: number): Point => {
    const angle = angleOf(k) + Math.PI / 6;
    return [cx + Math.sin(angle) * innerR, cz + Math.cos(angle) * innerR];
  };
  for (let k = 0; k < 6; k++) parts.push(ribbon(segment(inner(k), inner(k + 1), 12), [0.46, 0.56]));
  for (let k = 0; k < 6; k++) parts.push(ring(0.1, [0.54, 0.6], inner(k)[0], inner(k)[1], 20));
  // ⑥ 안쪽 겹원 — 사이에 한자 띠
  parts.push(ring(1.05, [0.52, 0.64]), ring(0.86, [0.56, 0.66]));
  // ⑦ 소반 둘레 — 겹원
  parts.push(ring(0.55, [0.66, 0.76], cx, cz, 60), ring(0.42, [0.7, 0.78], cx, cz, 50));
  // ⑧ 마지막 — 돌탑마다 소반으로 살이 뻗는다
  for (let k = 0; k < 6; k++) {
    const angle = angleOf(k);
    const from: Point = [cx + Math.sin(angle) * (R - 0.55), cz + Math.cos(angle) * (R - 0.55)];
    parts.push(ribbon(segment(from, [cx + Math.sin(angle) * 0.55, cz + Math.cos(angle) * 0.55]), [0.76, 0.92]));
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  return merged;
}

/** 홈 하나 — 돌탑이 설 둥근 테와 바깥 눈금(notches 개) */
/**
 * 돌탑 자리 표시 — 동그라미 대신 네 귀퉁이에 꺾쇠를 새겨 자리를 잡고, 그 바깥(원 바깥쪽)에 「바를 정(正)」 획으로 돌 수를 센다.
 * 다섯이 차면 正 한 자, 남은 수는 다음 자의 획. 돌탑을 세워도 가려지지 않게 바깥으로 뺐다.
 */
export function buildNodeMark(k: number) {
  const { x, z, notches } = NODES[k];
  // 원 바깥쪽 방향(가운데 → 자리)과 그 옆 방향
  const ox = (x - CIRCLE_CENTER.x) / CIRCLE_RADIUS;
  const oz = (z - CIRCLE_CENTER.z) / CIRCLE_RADIUS;
  const sx = -oz;
  const sz = ox;
  /** 자리 기준 (옆 a, 바깥 b) → 미터 점 */
  const at = (a: number, b: number): Point => [x + sx * a + ox * b, z + sz * a + oz * b];
  const parts: THREE.BufferGeometry[] = [];
  // 귀퉁이 꺾쇠 넷
  const half = NODE_RING_RADIUS;
  const arm = 0.14;
  for (const [ca, cb] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    parts.push(ribbon([at(ca * half, cb * half - cb * arm), at(ca * half, cb * half), at(ca * half - ca * arm, cb * half)], [0, 1], 0.035));
  }
  // 正 획 — 한 자의 다섯 획: 윗가로 · 가운데 세로 · 가운데 짧은 가로 · 왼 세로 · 아랫가로. 글자 크기 0.22, 자리 바깥 0.62 에
  const size = 0.22;
  const strokes: [number, number, number, number][] = [
    [-0.5, 0.5, 0.5, 0.5],
    [0, 0.5, 0, -0.5],
    [0, 0.02, 0.38, 0.02],
    [-0.36, 0.12, -0.36, -0.5],
    [-0.55, -0.5, 0.55, -0.5],
  ];
  const chars = Math.ceil(notches / 5);
  for (let c = 0; c < chars; c++) {
    const count = Math.min(5, notches - c * 5);
    const center = (c - (chars - 1) / 2) * size * 1.4;
    for (let n = 0; n < count; n++) {
      const [a0, b0, a1, b1] = strokes[n];
      // 글자 위쪽이 원 가운데를 향하게 — 바깥에서 다가오며 보면 바로 읽힌다(오른쪽 = −옆)
      const base = half + 0.26 + size / 2;
      parts.push(ribbon(segment(at(-(center + a0 * size), base - b0 * size), at(-(center + a1 * size), base - b1 * size), 3), [0, 1], 0.035));
    }
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  return merged;
}

/** 연한 빛 — 흰빛에 아주 옅은 물빛. 짙은 파랑은 쓰지 않는다 */
export const GLOW_COLOR = new THREE.Color("#EEF6F2");
/** 새겨진 홈 — 처음부터 보이는 것은 돌탑 자리(홈)뿐이다 */
export const CARVED_COLOR = new THREE.Color("#3C4044");

// 로그 깊이 버퍼를 쓰는 씬이라 직접 쓴 셰이더도 그 조각을 넣어야 깊이가 맞는다
const REVEAL_VERTEX = /* glsl */ `
  attribute float aReveal;
  varying float vReveal;
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vReveal = aReveal;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const REVEAL_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform vec3 uColor;
  uniform sampler2D uMap;
  uniform float uUseMap;
  varying float vReveal;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float lead = uProgress - vReveal;
    float shown = clamp(lead * 40.0, 0.0, 1.0);
    // 한자 띠는 글자판의 글자 모양만 밝힌다
    if (uUseMap > 0.5) shown *= texture2D(uMap, vUv).a;
    if (shown <= 0.0) discard;
    // 막 그려지는 끝은 더 밝다 — 빛이 선을 타고 흐르는 것처럼
    float head = smoothstep(0.05, 0.0, lead) * 1.6;
    float pulse = 0.85 + 0.15 * sin(uTime * 3.0 + vReveal * 12.0);
    gl_FragColor = vec4(uColor * (1.0 + head) * pulse, shown);
  }
`;

/** 진행(uProgress)만큼만 밝아지는 빛 선 재질 — 더해 칠한다. map 을 주면 그 글자판 모양만 밝힌다 */
export function makeRevealMaterial(map: THREE.Texture | null = null) {
  return new THREE.ShaderMaterial({
    vertexShader: REVEAL_VERTEX,
    fragmentShader: REVEAL_FRAGMENT,
    uniforms: {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: GLOW_COLOR.clone().multiplyScalar(1.3) },
      uMap: { value: map },
      uUseMap: { value: map ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}
