/**
 * 지형 높이 동일성·속도 검사(개발 전용, naju01/terrain-check.html).
 * 촘촘한 격자에서 groundAt 을 전부 불러 바이트 단위 지문을 낸다 — 지형 코드를 고쳐도 지문이 같으면 결과가 그대로다.
 * 땅 메시가 꼭짓점마다 이 조회를 부르므로 여기 걸린 시간이 곧 첫 화면을 붙잡는 비용이다(GPU 가 안 끼어 기계 차이도 적다).
 *   npx vite naju01 → /terrain-check.html. 헤드리스는 window.__game.terrainCheck 로 읽는다.
 */
import { exposeDevHook } from "@/debug/devHooks";

import { createNoise } from "../src/terrain/ground";
import { createTerrain, type Terrain, type TerrainOptions } from "../src/terrain/terrain";

// 코어(80 × 50 m)를 넉넉히 덮고, 실제 땅 메시 꼭짓점 수와 같은 자릿수로 잡는다
const BOUNDS = { x0: -10, x1: 90, z0: -10, z1: 60 };
const COLUMNS = 600;
const ROWS = 420;

/** FNV-1a — 배열의 바이트를 그대로 훑어 1비트만 달라도 지문이 바뀐다 */
function fingerprint(values: Float64Array | Uint8Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

interface GridResult {
  pointCount: number;
  heightFingerprint: string;
  kindFingerprint: string;
  elapsedMs: number;
  min: number;
  max: number;
}

function measureGrid(terrain: Terrain): GridResult {
  const count = (COLUMNS + 1) * (ROWS + 1);
  const heights = new Float64Array(count);
  // 높이가 같아도 판정(구역·통로·물)이 달라지면 안 되므로 갈래도 지문에 넣는다
  const kinds = new Uint8Array(count);
  const dx = (BOUNDS.x1 - BOUNDS.x0) / COLUMNS;
  const dz = (BOUNDS.z1 - BOUNDS.z0) / ROWS;

  const startedAt = performance.now();
  let i = 0;
  for (let a = 0; a <= COLUMNS; a += 1) {
    const x = BOUNDS.x0 + a * dx;
    for (let b = 0; b <= ROWS; b += 1) {
      const z = BOUNDS.z0 + b * dz;
      const sample = terrain.groundAt(x, z);
      heights[i] = sample.y;
      kinds[i] =
        (sample.path ? 1 : 0) |
        (sample.isShoulder ? 2 : 0) |
        (sample.isFall ? 4 : 0) |
        (sample.isWater ? 8 : 0) |
        (sample.zone ? 16 : 0);
      i += 1;
    }
  }
  const elapsed = performance.now() - startedAt;

  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < count; k += 1) {
    if (heights[k] < min) min = heights[k];
    if (heights[k] > max) max = heights[k];
  }
  return {
    pointCount: count,
    heightFingerprint: fingerprint(heights),
    kindFingerprint: fingerprint(kinds),
    elapsedMs: Math.round(elapsed),
    min: +min.toFixed(6),
    max: +max.toFixed(6),
  };
}

/** 지형을 새로 만드는 비용(구역·통로 실측·중심선 다듬기)도 따로 잰다 */
function measureCreate(options: TerrainOptions) {
  const startedAt = performance.now();
  const terrain = createTerrain(options);
  return { elapsedMs: Math.round(performance.now() - startedAt), terrain };
}

/** 값소음 — 땅 메시가 꼭짓점마다 부르는 두 번째로 큰 비용 */
function measureNoise() {
  // 옛 도구는 문자열 시드("바닥결")를 넘겼다 — makeRandom 의 >>> 0 에서 0 이 되므로 0 과 같다
  const noise = createNoise(0);
  const count = 2_000_000;
  const values = new Float64Array(count);
  const startedAt = performance.now();
  for (let i = 0; i < count; i += 1) {
    const x = (i % 1409) * 0.37 - 260;
    const z = ((i / 1409) | 0) * 0.29 - 180;
    values[i] = noise(x, z);
  }
  return { elapsedMs: Math.round(performance.now() - startedAt), fingerprint: fingerprint(values), pointCount: count };
}
const noiseResult = measureNoise();

// 색인을 끈 것과 켠 것을 같은 격자로 재서 지문과 시간을 견준다
const legacyBuild = measureCreate({ useIndex: false });
const indexedBuild = measureCreate({ useIndex: true });
const legacy = measureGrid(legacyBuild.terrain);
const indexed = measureGrid(indexedBuild.terrain);
const indexedAgain = measureGrid(indexedBuild.terrain);
const fingerprintsMatch =
  legacy.heightFingerprint === indexed.heightFingerprint && legacy.kindFingerprint === indexed.kindFingerprint;
const result = {
  legacy: { ...legacy, createMs: legacyBuild.elapsedMs },
  indexed: { ...indexed, createMs: indexedBuild.elapsedMs },
  isDeterministic:
    indexed.heightFingerprint === indexedAgain.heightFingerprint &&
    indexed.kindFingerprint === indexedAgain.kindFingerprint,
  fingerprintsMatch,
  speedup: +(legacy.elapsedMs / Math.max(1, indexed.elapsedMs)).toFixed(1),
  noise: noiseResult,
};
exposeDevHook("terrainCheck", result);

const text = [
  `격자 ${COLUMNS + 1} × ${ROWS + 1} = ${legacy.pointCount.toLocaleString()} 점`,
  "",
  `[옛것 — 모든 선분 훑기]  조회 ${legacy.elapsedMs} ms · 지형 만들기 ${legacyBuild.elapsedMs} ms`,
  `   높이 지문 ${legacy.heightFingerprint} · 갈래 지문 ${legacy.kindFingerprint} · 범위 ${legacy.min} ~ ${legacy.max}`,
  "",
  `[새것 — 공간 색인]      조회 ${indexed.elapsedMs} ms · 지형 만들기 ${indexedBuild.elapsedMs} ms`,
  `   높이 지문 ${indexed.heightFingerprint} · 갈래 지문 ${indexed.kindFingerprint} · 범위 ${indexed.min} ~ ${indexed.max}`,
  "",
  `★ 결과 지문 같음: ${fingerprintsMatch ? "예 — 한 비트도 안 바뀌었다" : "아니오 ← 고쳐야 한다"}`,
  `★ 조회 속도: ${result.speedup} 배 (${legacy.elapsedMs} ms → ${indexed.elapsedMs} ms)`,
  `   두 번 재서 지문 같음(결정적): ${result.isDeterministic ? "예" : "아니오"}`,
  "",
  `[값소음 — 바닥.js 소음만들기]  ${noiseResult.pointCount.toLocaleString()} 점 ${noiseResult.elapsedMs} ms · 지문 ${noiseResult.fingerprint}`,
].join("\n");
console.log(text);
const output = document.getElementById("result");
if (output) output.textContent = text;
document.title = `지형 ${fingerprintsMatch ? "지문같음" : "지문다름"} · ${result.speedup}배`;
