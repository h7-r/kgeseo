// 사람 공간 역분석(10/19 공간 연출 에이전트 A단계) — 무리마다 「어떤 자리에 · 얼마나 · 몇 m 로」 심었나를 센다.
// 자리 분류(지면 판정 그대로): 구역(Z#) · 길 · 물 · 벼랑면 · 걷는 곳에 닿은 가장자리(3 m 띠) · 언덕(걷지 않는 코어 땅) · 원경(코어 밖).
// 개발용 __game.naju.layoutCensus() 가 부른다. 게임 동작은 바꾸지 않는다.
import { applyEdits, type Edits, type InstanceGroup } from "../placement/instanceGroups";
import { CORE, RIVER } from "../plan/sitePlan";
import type { Terrain } from "./useTerrainLayers";

type Ctx = string;
const EDGE_M = 3;

function classify(terrain: Terrain, x: number, z: number): Ctx {
  if (x < CORE.x[0] || x > CORE.x[1] || z < CORE.z[0] || z > CORE.z[1]) return z > RIVER.zStart ? "원경·강건너" : "원경";
  const g = terrain.groundAt(x, z);
  if (g.isWater) return "물";
  if (g.isFall) return "벼랑면";
  if (g.path) return "길";
  if (g.zone) return `구역 ${g.zone}`;
  const near = z > RIVER.zStart - EDGE_M ? "물가" : null;
  for (let a = 0; a < 8; a++) {
    const n = terrain.groundAt(x + Math.cos((a * Math.PI) / 4) * EDGE_M, z + Math.sin((a * Math.PI) / 4) * EDGE_M);
    if (n.path || n.zone) return near ? "물가·걷는곳 가장자리" : "걷는곳 가장자리";
  }
  return near ?? "언덕";
}

const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null);
const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

export function layoutCensus(terrain: Terrain, groups: InstanceGroup[], edits: Edits | null) {
  // 자리 분류별 넓이(1 m 격자) — 밀도 = 개수 / 100 m²
  const area: Record<Ctx, number> = {};
  for (let x = CORE.x[0] + 0.5; x < CORE.x[1]; x++)
    for (let z = CORE.z[0] + 0.5; z < CORE.z[1]; z++) {
      const c = classify(terrain, x, z);
      area[c] = (area[c] || 0) + 1;
    }
  const out = groups.map((g) => {
    const spots = applyEdits(g.groupId, g.generatedSpots, edits).filter((s) => Number.isFinite(s.x) && Number.isFinite(s.z));
    const by: Record<Ctx, { n: number; sizes: number[] }> = {};
    for (const s of spots) {
      const c = classify(terrain, s.x, s.z);
      (by[c] ||= { n: 0, sizes: [] }).n++;
      by[c].sizes.push(s.size);
    }
    const sizes = spots.map((s) => s.size).filter(Number.isFinite);
    return {
      groupId: g.groupId,
      count: spots.length,
      sizeM: { min: r2(Math.min(...sizes)), median: r2(median(sizes)), max: r2(Math.max(...sizes)) },
      contexts: Object.fromEntries(
        Object.entries(by).map(([c, v]) => [
          c,
          { n: v.n, per100m2: area[c] ? r2((v.n / area[c]) * 100) : null, sizeMedian: r2(median(v.sizes)) },
        ]),
      ),
      // 몇 개 안 되는 무리(이야기 소품·인물)는 자리를 그대로
      spots: spots.length <= 12 ? spots.map((s) => ({ x: r2(s.x), z: r2(s.z), y: r2(s.y), size: r2(s.size), at: classify(terrain, s.x, s.z) })) : undefined,
    };
  });
  return { areaM2: area, groups: out };
}

/**
 * 공간 지형 칸 지도(10/19 공간 구성 단계) — 1 m 칸마다 지형 종류·구역·높이·경사. 사람이 놓은 물체는 넣지 않는다(지형만).
 * kind: zone · path · walkEdge(걷는 곳에서 3 m 안쪽 띠) · hill · waterEdge(물가 3 m) · water · cliffFace
 * 칸 코드 하나로 줄인다: kinds[i] = 종류 번호, zones[i] = 구역 번호(0 없음), y·slope 는 0.1 m · 0.01 단위 정수.
 */
/** waterY: 수면 높이(m) — 강 수면 메시는 y=0 평면(world/river.ts buildRiverSurface, 물결만 ±) */
export function spaceMask(terrain: Terrain, cell = 1, waterY = 0) {
  const KINDS = ["zone", "path", "walkEdge", "hill", "waterEdge", "water", "cliffFace", "waterWalkEdge"];
  const zoneCodes = terrain.zones.map((z) => z.code);
  const nx = Math.round((CORE.x[1] - CORE.x[0]) / cell);
  const nz = Math.round((CORE.z[1] - CORE.z[0]) / cell);
  const kinds: number[] = [];
  const zones: number[] = [];
  const ys: number[] = [];
  const slopes: number[] = [];
  const kindOf = (x: number, z: number) => {
    const g = terrain.groundAt(x, z);
    if (g.isWater) return "water";
    if (g.isFall) return "cliffFace";
    if (g.path) return "path";
    if (g.zone) return "zone";
    const nearWater = z > RIVER.zStart - EDGE_M;
    for (let a = 0; a < 8; a++) {
      const n = terrain.groundAt(x + Math.cos((a * Math.PI) / 4) * EDGE_M, z + Math.sin((a * Math.PI) / 4) * EDGE_M);
      if (n.path || n.zone) return nearWater ? "waterWalkEdge" : "walkEdge";
    }
    return nearWater ? "waterEdge" : "hill";
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = CORE.x[0] + (i + 0.5) * cell;
      const z = CORE.z[0] + (j + 0.5) * cell;
      const g = terrain.groundAt(x, z);
      kinds.push(KINDS.indexOf(kindOf(x, z)));
      zones.push(g.zone ? zoneCodes.indexOf(g.zone) + 1 : 0);
      ys.push(Math.round(g.y * 10));
      const gx = terrain.groundAt(x + 0.5, z).y - terrain.groundAt(x - 0.5, z).y;
      const gz = terrain.groundAt(x, z + 0.5).y - terrain.groundAt(x, z - 0.5).y;
      slopes.push(Math.round(Math.hypot(gx, gz) * 100));
    }
  // v2(10/19): 수면 높이 · 차단물(바위 능선 등 지형 덩어리) — 에이전트 배치가 물에 뜨는 물건을 수면에 맞추고 차단물 속에 물건을 심지 않게
  return {
    version: 2, cell, origin: [CORE.x[0], CORE.z[0]], nx, nz, kinds: KINDS, zoneCodes, kind: kinds, zone: zones, y10: ys, slope100: slopes,
    waterY,
    blockers: terrain.blockers.map((b) => ({ code: b.code, x: b.x, z: b.z, top: +(b.floor + b.height).toFixed(2) })),
    note: "지형만(사람 배치 물체 없음). 게임 지면 판정(terrain.groundAt)에서 뽑음 · waterY = 수면 높이(m) · blockers = 지형 차단물 사각형",
  };
}
