// 통발을 코드로 엮는다 — 구운 fishTrap.json 을 새로 쓴다.
//   node tools/make-fishtrap.mjs
//
// (10/20 미르: 「통발 그물망이 다 찢겨져 보인다. 퀄리티를 끌어올려라」)
//   옛 통발은 격자 그물 GLB(4만 4천 면)를 1,606 면으로 줄인 것이라 가는 살이 끊겨 찢어진 그물처럼 보였다.
//   가는 살은 줄이면 반드시 끊긴다 → 처음부터 살 한 가닥씩 납작한 띠로 만든다(면 수는 비슷하게 1.2천).
//
// 모양(대오리 통발): 길이 방향이 Z. z=0 아가리(안으로 들어간 깔때기) → 몸통 → z=1 꼬리(좁혀 묶음).
//   · 세로 살 24 가닥  · 테(둥근 띠) 6 줄  · 아가리 깔때기 살 20 가닥  · 꼬리 매듭
//   살은 납작한 띠라 두 면으로 그린다(배치 쪽 doubleSided).
// 규약: lying — Z 폭 1 · 밑동 y=0 · XZ 한복판(bakedMesh.normalizeToRule)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeToRule, toBase64 } from "./bakedMesh.mjs";

const NAJU_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(NAJU_ROOT, "src", "models", "baked", "fishTrap.json");

let seed = 20261020;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const positions = [];
const indices = [];
const vert = (x, y, z) => (positions.push(x, y, z), positions.length / 3 - 1);
const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d);

// 몸통 반지름: 아가리 0.21 → 몸통 0.215(살짝 배부름) → 꼬리 0.06
const R0 = 0.21;
const radiusAt = (z) => {
  if (z <= 0.62) return R0 + 0.012 * Math.sin((z / 0.62) * Math.PI);
  const t = (z - 0.62) / 0.38;
  return R0 + (0.06 - R0) * (t * t * (3 - 2 * t));
};
const CY = R0 + 0.02; // 축 높이(눕혀 둔 통발이 바닥에 닿게)
const onSurface = (a, z, r) => [Math.cos(a) * r, CY + Math.sin(a) * r, z];

// 띠 하나: 중심선 점들과 각 점의 '옆' 방향을 받아 폭 w 의 납작한 띠
function strip(points, sides, w) {
  let prev = null;
  for (let i = 0; i < points.length; i++) {
    const [px, py, pz] = points[i];
    const [sx, sy, sz] = sides[i];
    const a = vert(px - sx * w, py - sy * w, pz - sz * w);
    const b = vert(px + sx * w, py + sy * w, pz + sz * w);
    if (prev) quad(prev[0], prev[1], b, a);
    prev = [a, b];
  }
}

// ① 세로 살 24
const SLATS = 24;
for (let k = 0; k < SLATS; k++) {
  const a = (k / SLATS) * Math.PI * 2 + (rand() - 0.5) * 0.04;
  const pts = [];
  const sides = [];
  const SEG = 12;
  for (let i = 0; i <= SEG; i++) {
    const z = 0.02 + (i / SEG) * 0.96;
    const r = radiusAt(z) + (rand() - 0.5) * 0.003;
    pts.push(onSurface(a, z, r));
    sides.push([-Math.sin(a), Math.cos(a), 0]);
  }
  strip(pts, sides, 0.009 + rand() * 0.002);
}

// ② 테 6 줄 — 살 바깥에 감는다
for (const z of [0.03, 0.2, 0.4, 0.6, 0.78, 0.92]) {
  const r = radiusAt(z) + 0.006;
  const pts = [];
  const sides = [];
  const SEG = 40;
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pts.push(onSurface(a, z, r));
    sides.push([0, 0, 1]);
  }
  strip(pts, sides, z < 0.05 ? 0.016 : 0.011);
}

// ③ 아가리 깔때기 — 입구에서 안쪽으로 좁아지는 살 20 가닥 + 안쪽 테 하나
const FUNNEL = 20;
for (let k = 0; k < FUNNEL; k++) {
  const a = (k / FUNNEL) * Math.PI * 2 + 0.07;
  const pts = [];
  const sides = [];
  const SEG = 5;
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const z = 0.03 + t * 0.27;
    const r = R0 - 0.004 + (0.06 - R0) * Math.pow(t, 0.85);
    pts.push(onSurface(a, z, r));
    sides.push([-Math.sin(a), Math.cos(a), 0]);
  }
  strip(pts, sides, 0.006);
}
{
  const pts = [];
  const sides = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(onSurface(a, 0.3, 0.062));
    sides.push([0, 0, 1]);
  }
  strip(pts, sides, 0.006);
}

// ④ 꼬리 매듭 — 살 끝을 모아 묶은 짧은 팔각 기둥
{
  const N = 8;
  const z0 = 0.955;
  const z1 = 1.0;
  const rr = 0.045;
  const ring0 = [];
  const ring1 = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    ring0.push(vert(Math.cos(a) * rr, CY + Math.sin(a) * rr, z0));
    ring1.push(vert(Math.cos(a) * rr * 0.8, CY + Math.sin(a) * rr * 0.8, z1));
  }
  for (let i = 0; i < N; i++) quad(ring0[i], ring0[(i + 1) % N], ring1[(i + 1) % N], ring1[i]);
  const cap = vert(0, CY, z1);
  for (let i = 0; i < N; i++) indices.push(ring1[i], ring1[(i + 1) % N], cap);
}

const normalized = normalizeToRule(Float32Array.from(positions), "lying", 0.8);
const idx = Uint16Array.from(indices);
const model = {
  name: "fishTrap",
  source: "코드 생성(tools/make-fishtrap.mjs) — 옛 출처 통발.glb 격자 그물 감면본 대체(10/20)",
  rule: "lying",
  bakeCommand: "node tools/make-fishtrap.mjs",
  size: normalized.size,
  vertexCount: positions.length / 3,
  triangleCount: idx.length / 3,
  positions: toBase64(normalized.positions),
  indices: toBase64(idx),
};
fs.writeFileSync(OUT, JSON.stringify(model, null, 2) + "\n");
console.log(`통발 — 꼭짓점 ${model.vertexCount} · 삼각형 ${model.triangleCount} · 크기 ${JSON.stringify(model.size)} → ${path.relative(NAJU_ROOT, OUT)}`);
