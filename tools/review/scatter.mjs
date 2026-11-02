// scatter.mjs — 공간 구성 단계의 「코드 배치」(10/19). LLM 은 무엇을·어느 지형 칸에·얼마나·어떻게(뭉치게/고르게/줄로)만 정하고,
// 좌표는 여기서 공간 지형 칸 지도(docs/에셋라이브러리/공간/<slug>.mask.json)로 계산한다. 같은 씨앗이면 늘 같은 결과.
// 일반 규칙만 쓴다(특정 설화·사람 답안의 수치 없음): 걷는 곳은 비우고, 경사가 급하면 큰 나무를 안 세우고, 큰 물건끼리 안 겹치고,
// 크기를 섞고, 「뭉치게」면 잡음으로 덩이를 만든다.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REGION_KINDS = Object.freeze({
  zone: '걷는 구역 안(구역 지정 필수)',
  zone_edge: '걷는 구역 안 가장자리 1.5 m 띠(구역 지정 필수)',
  zone_waterside: '걷는 구역 안 물가 3 m(구역 지정 필수)',
  walk_edge: '걷는 곳(구역·길) 바로 바깥 3 m 띠 — 길·마당 둘레',
  hill: '걷지 않는 언덕·비탈(걷는 곳에서 3 m 이상)',
  hill_rim: '언덕 바깥 테두리(걷는 곳에서 8 m 이상 — 공간 끝을 닫는 숲)',
  water_edge: '걷는 구역 밖 물가 땅',
  water: '물 위(물가에서 2 m 안)',
  cliff_face: '벼랑면(가파른 바위면)',
  path: '길 위(잔돌 같은 밟히는 것만)',
});
export const CLASSES = Object.freeze({
  // [밀도(100 m² 당) 성김·보통·빽빽, 최소 간격 m, 견딜 경사(높이/거리)]
  tree: [[1.2, 3, 6], 2.2, 1.0],
  shrub: [[2, 5, 9], 1.0, 1.8],
  grass: [[3, 7, 14], 0.5, 2.5],
  flower: [[1.5, 4, 8], 0.5, 1.5],
  reed: [[4, 9, 16], 0.4, 1.0],
  rock: [[0.4, 1.2, 3], 1.5, 3],
  pebble: [[5, 15, 40], 0.3, 3],
  prop: [[0.5, 1, 2], 0.8, 0.6],
});
const LEVEL = { sparse: 0, medium: 1, dense: 2 };

export function loadMask(root, slug = 'naju01_angam') {
  const m = JSON.parse(readFileSync(path.join(root, 'docs/에셋라이브러리/공간', `${slug}.mask.json`), 'utf8'));
  const n = m.nx * m.nz;
  const K = Object.fromEntries(m.kinds.map((k, i) => [k, i]));
  const walk = new Uint8Array(n); const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) { walk[i] = m.kind[i] === K.zone || m.kind[i] === K.path ? 1 : 0; water[i] = m.kind[i] === K.water ? 1 : 0; }
  // 거리장(칸 단위, 8방향 근사) — 물·걷는 곳·걷지 않는 곳까지
  const dist = src => {
    const d = new Float32Array(n).fill(1e9);
    for (let i = 0; i < n; i++) if (src(i)) d[i] = 0;
    const pass = (i, j, di, dj, w) => { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= m.nx || b >= m.nz) return; const v = d[b * m.nx + a] + w; if (v < d[j * m.nx + i]) d[j * m.nx + i] = v; };
    for (let j = 0; j < m.nz; j++) for (let i = 0; i < m.nx; i++) { pass(i, j, -1, 0, 1); pass(i, j, 0, -1, 1); pass(i, j, -1, -1, 1.414); pass(i, j, 1, -1, 1.414); }
    for (let j = m.nz - 1; j >= 0; j--) for (let i = m.nx - 1; i >= 0; i--) { pass(i, j, 1, 0, 1); pass(i, j, 0, 1, 1); pass(i, j, 1, 1, 1.414); pass(i, j, -1, 1, 1.414); }
    for (let i = 0; i < n; i++) d[i] *= m.cell;
    return d;
  };
  // 지형 차단물(바위 능선 등) 칸 — 어떤 영역에도 넣지 않는다(10/19: 차단물 바위 속에 나무가 박혔다). 둘레 0.5 m 까지
  const blocked = new Uint8Array(n);
  for (const b of m.blockers || []) for (let k = 0; k < n; k++) {
    const x = m.origin[0] + ((k % m.nx) + 0.5) * m.cell, z = m.origin[1] + (Math.floor(k / m.nx) + 0.5) * m.cell;
    if (x > b.x[0] - 0.5 && x < b.x[1] + 0.5 && z > b.z[0] - 0.5 && z < b.z[1] + 0.5) blocked[k] = 1;
  }
  return { ...m, K, n, walk, water, blocked, waterY: Number.isFinite(m.waterY) ? m.waterY : 0, dWater: dist(i => water[i]), dWalk: dist(i => walk[i]), dNonWalk: dist(i => !walk[i]) };
}
const idx = (m, x, z) => { const i = Math.floor((x - m.origin[0]) / m.cell); const j = Math.floor((z - m.origin[1]) / m.cell); return i < 0 || j < 0 || i >= m.nx || j >= m.nz ? -1 : j * m.nx + i; };
const center = (m, k) => [m.origin[0] + ((k % m.nx) + 0.5) * m.cell, m.origin[1] + (Math.floor(k / m.nx) + 0.5) * m.cell];

/** 지형 칸 하나가 이 영역에 드나 */
export function inRegion(m, k, region) {
  if (m.blocked?.[k]) return false;
  const kind = m.kinds[m.kind[k]];
  const zone = m.zone[k] ? m.zoneCodes[m.zone[k] - 1] : null;
  const zones = region.zones?.length ? region.zones : null;
  switch (region.kind) {
    case 'zone': return kind === 'zone' && (!zones || zones.includes(zone));
    case 'zone_edge': return kind === 'zone' && (!zones || zones.includes(zone)) && m.dNonWalk[k] <= 1.5;
    case 'zone_waterside': return kind === 'zone' && (!zones || zones.includes(zone)) && m.dWater[k] <= 3;
    case 'walk_edge': return (kind === 'walkEdge' || kind === 'waterWalkEdge') && nearZones(m, k, zones);
    case 'hill': return kind === 'hill' && nearZones(m, k, zones);
    case 'hill_rim': return kind === 'hill' && m.dWalk[k] >= 8 && nearZones(m, k, zones);
    case 'water_edge': return (kind === 'waterEdge' || kind === 'waterWalkEdge') && nearZones(m, k, zones);
    case 'water': return kind === 'water' && m.dWater[k] === 0 && waterNearShore(m, k) && nearZones(m, k, zones);
    case 'cliff_face': return kind === 'cliffFace' && nearZones(m, k, zones);
    case 'path': return kind === 'path' && nearZones(m, k, zones);
    default: return false;
  }
}
function waterNearShore(m, k) { const [x, z] = center(m, k); for (let d = 1; d <= 2; d++) { const u = idx(m, x, z - d); if (u >= 0 && !m.water[u]) return true; } return false; }
/** 구역 이름을 준 비걷는 영역은 그 구역 사각형에서 12 m 안쪽만 */
function nearZones(m, k, zones) {
  if (!zones) return true;
  const [x, z] = center(m, k);
  return zones.some(code => { const r = m.zoneRects?.[code]; if (!r) return true; const dx = Math.max(r.x[0] - x, 0, x - r.x[1]); const dz = Math.max(r.z[0] - z, 0, z - r.z[1]); return Math.hypot(dx, dz) <= 12; });
}

// ── 땅에 앉히기(10/19) — 공중에 뜨거나 비탈에 박히는 것을 막는 일반 규칙 ──
// 마스크 높이(y10, 1 m 칸)를 쌍선형으로 읽는다. 물 칸은 강바닥 높이다.
export function groundY(m, x, z) {
  const fx = (x - m.origin[0]) / m.cell - 0.5, fz = (z - m.origin[1]) / m.cell - 0.5;
  const i = Math.max(0, Math.min(m.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(m.nz - 2, Math.floor(fz)));
  const u = Math.max(0, Math.min(1, fx - i)), w = Math.max(0, Math.min(1, fz - j));
  const y = (a, b) => m.y10[(j + b) * m.nx + i + a] / 10;
  return y(0, 0) * (1 - u) * (1 - w) + y(1, 0) * u * (1 - w) + y(0, 1) * (1 - u) * w + y(1, 1) * u * w;
}
const isWaterAt = (m, x, z) => { const k = idx(m, x, z); return k >= 0 && m.water[k] === 1; };
/**
 * 앉힘 규칙 — 물건의 성격으로 정한다(설화·공간과 무관한 물리 규칙).
 *  flat    단단한 바닥 물건·가구·인물: 발판 안 높낮이가 허용치(0.12 m 또는 키의 6%) 넘으면 그 자리는 안 됨. 물 칸 금지
 *  natural 바위·돌: 발판 가장 낮은 곳까지 내려 앉힌다(뜨지 않게). 높낮이가 키의 60% 넘으면 안 됨
 *  plant   나무·풀: 줄기 둘레(0.3 m)만 보고 가장 낮은 곳에 맞춘다
 *  float   배·뗏목: 발판 전부가 물 칸이어야 하고, 수면 − 흘수(키의 12%)에 띄운다
 *  stake   물에 박는 것(말뚝·어살): 물 깊이가 (키 − 0.3 m) 이하인 곳만
 * 돌려주는 값: { ok, dy(그 자리 지면 판정 대비 높이 보정 m), range(발판 높낮이 m), reason }
 */
export function seatSpot(m, x, z, { rule = 'flat', foot = 0.5, h = 1, steep = false, half = null, rot = 0 } = {}) {
  // 풀·덤불 덩이는 폭이 넓어 비탈 아래쪽이 뜬다 → 덩이 폭의 60%(최대 0.8 m)까지 보고 낮은 쪽에 맞춘다. 나무는 줄기 둘레만(가지는 떠도 된다)
  const r = rule === 'plant' ? (h >= 2 ? Math.min(0.3, foot) : Math.min(0.8, Math.max(0.15, foot * 0.6))) : Math.max(0.15, foot);
  const pts = [[x, z]];
  if (half && rule !== 'plant') {
    // 길쭉한 물건(배·평상)은 실제 가로·깊이 사각형을 돌림대로 — 원으로 재면 배가 좁은 물가에 못 들어간다(10/19)
    const t = (rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { if (!a && !b) continue; const lx = (a / 2) * Math.max(0.1, half[0]), lz = (b / 2) * Math.max(0.1, half[1]); pts.push([x + lx * c + lz * sn, z - lx * sn + lz * c]); }
  } else {
    for (let a = 0; a < 8; a++) pts.push([x + Math.cos((a * Math.PI) / 4) * r, z + Math.sin((a * Math.PI) / 4) * r]);
    if (rule === 'flat' || rule === 'natural') for (let a = 0; a < 8; a++) pts.push([x + Math.cos((a * Math.PI) / 4 + 0.39) * r * 0.55, z + Math.sin((a * Math.PI) / 4 + 0.39) * r * 0.55]);
  }
  // 가운데가 공간 밖이면 안 됨. 발판 끝이 공간 끝을 조금 넘는 것은 끝 칸 높이로 잰다(테두리 숲이 끝에서 끊기지 않게)
  if (idx(m, x, z) < 0) return { ok: false, reason: '공간 밖' };
  const ox = m.origin[0], oz = m.origin[1], X1 = ox + m.nx * m.cell - 1e-3, Z1 = oz + m.nz * m.cell - 1e-3;
  for (const p of pts) { p[0] = Math.min(X1, Math.max(ox, p[0])); p[1] = Math.min(Z1, Math.max(oz, p[1])); }
  // 식물은 가운데(줄기)만 차단물에 안 들면 된다 — 잎이 바위에 걸치는 건 자연스럽다
  for (const [px, pz] of rule === 'plant' ? [pts[0]] : pts) { const k = idx(m, px, pz); if (m.blocked?.[k]) return { ok: false, reason: '차단물' }; }
  const ys = pts.map(([px, pz]) => groundY(m, px, pz));
  const y0 = ys[0], lo = Math.min(...ys), hi = Math.max(...ys), range = hi - lo;
  const wet = pts.filter(([px, pz]) => isWaterAt(m, px, pz)).length;
  switch (rule) {
    case 'float': {
      if (wet < pts.length) return { ok: false, range, reason: '발판이 물 밖에 걸침' };
      const top = m.waterY - h * 0.12; // 흘수: 배 가운데(용골) 밑만 물이 충분하면 된다 — 뱃머리 쪽이 얕은 물가에 닿는 건 나루에서 흔하다
      if (top - 0.05 < y0) return { ok: false, range, reason: '물이 얕아 바닥에 닿음' };
      return { ok: true, dy: +(top - y0).toFixed(3), range };
    }
    case 'stake': return m.waterY - lo <= h - 0.3 ? { ok: true, dy: +(lo - y0).toFixed(3), range } : { ok: false, range, reason: '물이 깊어 잠김' };
    // 벼랑면 바위는 비탈에 박혀 있는 게 자연스럽다(steep) — 낮은 쪽까지 내려 앉힌다
    //   단 키의 35% 넘게 묻지 않는다(벼랑에서 5 m 묻혀 사라진 바위, 10/19)
    case 'natural': return steep || range <= Math.max(0.25, h * 0.6) ? { ok: true, dy: +Math.max(lo - y0, -h * 0.35).toFixed(3), range } : { ok: false, range, reason: '비탈이 너무 급함' };
    case 'plant': return { ok: true, dy: +(lo - y0).toFixed(3), range };
    default: {
      if (wet) return { ok: false, range, reason: '물 위' };
      return range <= Math.max(0.12, h * 0.06) ? { ok: true, dy: +(lo + range / 2 - y0).toFixed(3), range } : { ok: false, range, reason: `바닥이 고르지 않음(${range.toFixed(2)} m)` };
    }
  }
}
/** 분류·이름·영역으로 앉힘 규칙을 고른다. 계획이 ground 를 적어 주면 그것을 쓴다 */
export function seatRule({ ground, cls, layer, name = '', region } = {}) {
  if (['flat', 'natural', 'plant', 'float', 'stake'].includes(ground)) return ground;
  if (layer === 'cast') return 'flat';
  if (['tree', 'shrub', 'grass', 'flower', 'reed'].includes(cls)) return 'plant';
  if (['rock', 'pebble'].includes(cls)) return 'natural';
  const inWater = region?.kind === 'water';
  if (inWater && /배|boat|뗏목|raft|부표|buoy/i.test(name) && !/뒤집/.test(name)) return 'float';
  if (inWater) return 'stake';
  if (/바위|돌무더기|자갈|rock|stone|boulder/i.test(name) && !/돌판|비석|표지석|새김|석상|장승|돌상/.test(name)) return 'natural';
  return 'flat';
}

// ── 씨앗 난수 · 값 잡음 ──
export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const hash32 = str => { let h = 2166136261; for (const c of String(str)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function noise(seed, x, z, scale) {
  const h = (i, j) => { let v = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const fx = x / scale, fz = z / scale; const i = Math.floor(fx), j = Math.floor(fz); const u = fx - i, w = fz - j;
  const s = t => t * t * (3 - 2 * t);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return a + (b - a) * s(u) + (c - a) * s(w) + (a - b - c + d) * s(u) * s(w);
}

/**
 * 배치 한 묶음.
 * layer: { id, class, assets:[asset_id], region:{kind, zones?}, density:'sparse|medium|dense' | count:n, sizeM:[min,max], pattern:'patchy|even|line', slopeMax? }
 * occ: 전체가 함께 쓰는 점유 목록(큰 물건끼리 겹치지 않게)
 */
export function scatterLayer(m, layer, occ = [], seedBase = 1) {
  const cls = CLASSES[layer.class] || CLASSES.prop;
  const [densities, spacing0, slopeMax] = cls;
  const spacing = Number.isFinite(layer.spacing) ? layer.spacing : spacing0; // 뼈대 숲은 수관이 겹치게 간격을 줄인다
  const R = rng(hash32(`${seedBase}:${layer.id}`));
  // 벼랑면은 원래 가파르다 — 경사 거름을 하지 않는다(거기 갈 수 있는 것만 고르는 건 계획 단계 몫)
  const steepOk = layer.region.kind === 'cliff_face';
  const cells = []; for (let k = 0; k < m.n; k++) if (inRegion(m, k, layer.region) && (steepOk || m.slope100[k] / 100 <= (layer.slopeMax ?? slopeMax))) cells.push(k);
  if (!cells.length) return { spots: [], area: 0, reason: '해당 지형 칸이 없음' };
  const area = cells.length * m.cell * m.cell;
  // 좁은 영역에서 「성김」이 0개로 반올림되지 않게 — 20 m² 넘으면 적어도 1개
  const target = Number.isFinite(layer.count) ? layer.count : Math.max(area >= 20 ? 1 : 0, Math.round(area * densities[LEVEL[layer.density] ?? 1] / 100));
  const [hMin, hMax] = [...(layer.sizeM || [1, 1])].map(Number).sort((a, b) => a - b); // LLM 이 [큰, 작은] 으로 줄 때가 있다
  const patchy = (layer.pattern || 'patchy') === 'patchy';
  const thicket = patchy && ['shrub', 'grass', 'flower', 'reed'].includes(layer.class);
  const nSeed = hash32(`n:${layer.id}`);
  const spots = []; const rejected = {};
  const big = hMax >= 1.2; // 1.2 m 넘는 것은 점유 목록에 넣어 서로 안 겹치게
  for (let tries = 0; spots.length < target && tries < target * (patchy ? 150 : 40); tries++) { // 뭉치게는 잡음이 많이 거른다 — 시도를 늘림
    // 덤불·풀은 덤불숲으로 — 이미 놓인 것 곁에서 자라게(겹쳐도 됨). 고르게 흩으면 물방울 무늬처럼 보인다(10/20 위에서 본 화면)
    let x, z, grow = false;
    // 나무도 무리 지어 — 고르게 흩으면 같은 간격으로 심은 조림지처럼 보인다(10/20). 절반은 기존 나무 곁 1.5~4 m 에서 자란다
    const clumpTree = layer.class === 'tree' && patchy && spots.length && R() < 0.5;
    if ((thicket && spots.length && R() < 0.72) || clumpTree) {
      const a0 = spots[Math.floor(R() * spots.length)]; const a = R() * Math.PI * 2, d = clumpTree ? 1.5 + R() * 2.5 : 0.35 + R() * (0.5 + a0.heightM * 0.7);
      x = a0.x + Math.cos(a) * d; z = a0.z + Math.sin(a) * d; grow = true;
      const kk = idx(m, x, z); if (kk < 0 || !inRegion(m, kk, layer.region)) continue;
    } else {
      const k = cells[Math.floor(R() * cells.length)];
      const [cx, cz] = center(m, k);
      x = cx + (R() - 0.5) * m.cell; z = cz + (R() - 0.5) * m.cell;
    }
    x = Math.round(x * 100) / 100; z = Math.round(z * 100) / 100; // 저장 값과 같은 좌표로 판정
    if (patchy && !grow) { const v = noise(nSeed, x, z, 7); if (R() > Math.pow(Math.max(0, (v - 0.35) / 0.65), 1.2)) continue; }
    const h = hMin + (hMax - hMin) * (thicket ? R() : Math.pow(R(), 1.4));
    const r = thicket ? Math.max(0.22, h * 0.35) : Math.max(spacing, big && !Number.isFinite(layer.spacing) ? h * 0.25 : spacing);
    if (spots.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < (r * 0.9) ** 2)) continue;
    if (big && occ.some(o => !(o.env && layer.overlapEnv) && (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r * 0.6) ** 2)) continue; // overlapEnv: 뼈대 숲은 다른 배경과 수관이 겹쳐도 됨(낱개 물건은 피함)
    const assetId = layer.assets[Math.floor(R() * layer.assets.length)];
    const foot = (layer.footOf?.(assetId) ?? 0.4) * h; // 발판 반지름 = 에셋 (가로·깊이 큰 쪽/2 ÷ 키) × 놓을 키
    // 수관이 걷는 곳을 덮지 않게(10/20 위에서 본 화면: 길가의 넓은 피나무가 나루터 마당을 덮음) — 걷는 곳 위로 1.5 m 까지만 뻗게
    if (layer.class === 'tree') { const kk = idx(m, x, z); if (kk >= 0 && foot - m.dWalk[kk] > 1.5) { rejected['수관이 걷는 곳을 덮음'] = (rejected['수관이 걷는 곳을 덮음'] || 0) + 1; continue; } }
    const seat = seatSpot(m, x, z, { rule: layer.rule || seatRule({ cls: layer.class }), foot, h, steep: steepOk });
    if (!seat.ok) { rejected[seat.reason] = (rejected[seat.reason] || 0) + 1; continue; }
    spots.push({ x: +x.toFixed(2), z: +z.toFixed(2), heightM: +h.toFixed(2), rotationY: Math.round(R() * 360), assetId, dy: seat.dy || 0, r });
  }
  if (big) for (const s of spots) occ.push({ x: s.x, z: s.z, r: s.r, env: true });
  return { spots: spots.map(({ r, ...s }) => s), area: +area.toFixed(1), target, rejected };
}

/** 낱개·무리·줄(이야기 물건·시설·인물) — 자리 힌트(x,z)를 그 영역의 가장 가까운 칸으로 옮기고 겹치지 않게 */
export function placeItem(m, item, occ = [], seedBase = 1) {
  const R = rng(hash32(`${seedBase}:${item.id}`));
  const cells = []; for (let k = 0; k < m.n; k++) if (inRegion(m, k, item.region)) cells.push(k);
  if (!cells.length) return { spots: [], reason: `${item.region.kind}${item.region.zones ? ' ' + item.region.zones.join('/') : ''} 에 칸이 없음` };
  const count = Math.max(1, Math.min(12, item.count || 1));
  const [hMin, hMax] = [...(item.sizeM || [1, 1])].map(Number).sort((a, b) => a - b);
  // 발판 반지름: 에셋 실제 가로·깊이(item.foot) — 없으면 키로 어림. 겹침 간격도 발판으로(평상 3 m 를 키 0.5 m 로 재면 겹친다)
  const foot = Number.isFinite(item.foot) ? item.foot : hMax * 0.35;
  const r = Math.max(0.5, foot);
  const rule = item.rule || 'flat';
  const hint = Number.isFinite(item.x) && Number.isFinite(item.z) ? [item.x, item.z] : center(m, cells[Math.floor(cells.length / 2)]);
  const byDist = cells.map(k => { const [x, z] = center(m, k); return [k, (x - hint[0]) ** 2 + (z - hint[1]) ** 2]; }).sort((a, b) => a[1] - b[1]);
  const spots = [];
  const rejected = {};
  const half = Array.isArray(item.half) && rule !== 'natural' ? item.half : null; // 바위는 모양이 제각각 — 원 발판으로 재고 돌림은 자유롭게
  const rot0 = Number.isFinite(item.rotationY) ? item.rotationY : Math.round(R() * 360);
  // 사각 발판이면 돌림 4방향을 차례로 본다(힌트 방향 먼저) — 고른 돌림을 자리에 그대로 쓴다
  const seatAt = (x, z) => { let last = null; for (const d of half ? [0, 90, 180, 270] : [0]) { const rot = (rot0 + d) % 360; const seat = seatSpot(m, x, z, { rule, foot, h: hMax, steep: item.region?.kind === 'cliff_face', half, rot }); if (seat.ok) return { ...seat, rot }; last = seat; } return last; };
  const ok = (x, z, rr) => {
    if (!(idx(m, x, z) >= 0 && inRegion(m, idx(m, x, z), item.region) && !spots.some(s => Math.hypot(s.x - x, s.z - z) < rr) && !occ.some(o => Math.hypot(o.x - x, o.z - z) < o.r + rr * 0.6))) return false;
    const seat = seatAt(x, z); if (!seat.ok) rejected[seat.reason] = (rejected[seat.reason] || 0) + 1;
    return seat.ok;
  };
  let anchor = null;
  // 칸 가운데뿐 아니라 칸 안 4점도 본다 — 좁은 평지에 큰 물건을 앉힐 수 있게
  for (const [k] of byDist) { const [cx, cz] = center(m, k); for (const [ox, oz] of [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) { if (ok(cx + ox * m.cell, cz + oz * m.cell, r)) { anchor = [cx + ox * m.cell, cz + oz * m.cell]; break; } } if (anchor) break; }
  if (!anchor) return { spots: [], reason: `앉힐 자리가 없음(${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(' · ') || '빈 칸 없음'})` };
  const arrangement = item.arrangement || (count > 1 ? 'group' : 'single');
  // 줄·무리는 손으로 놓은 것처럼(10/20 미르: 같은 간격·같은 돌림·같은 크기로 서 있으면 현실과 괴리) —
  //   간격 0.75~1.3배, 줄 옆으로 조금씩 비껴, 줄 방향도 조금씩 휘게, 돌림은 줄 방향 ±15°(무리는 ±40°), 크기는 0.86~1.12배
  let dir = ((item.rowAngle ?? 0) * Math.PI) / 180;
  const base = Math.max(1, hMax * 0.8) + 0.3;
  let along = 0;
  const spread = count > 1 ? [0.86, 1.12] : [0.95, 1.05];
  for (let i = 0; i < count && spots.length < count; i++) {
    let x = anchor[0], z = anchor[1];
    if (arrangement === 'row' && i > 0) { along += base * (0.75 + R() * 0.55); dir += (R() - 0.5) * 0.28; }
    for (let t = 0; t < 30; t++) {
      if (i === 0 && t === 0) break;
      if (arrangement === 'row') { const side = (R() - 0.5) * base * 0.5; x = anchor[0] + Math.cos(dir) * along - Math.sin(dir) * side + (R() - 0.5) * 0.2 * t; z = anchor[1] + Math.sin(dir) * along + Math.cos(dir) * side + (R() - 0.5) * 0.2 * t; }
      // 무리는 한 덩이로 — 반경을 (발판×2 + 개수×0.4 m)로 묶는다(10/19: 나무패 6개가 11 m 로 흩어짐)
      else { const a = R() * Math.PI * 2; const d = Math.min(r * 2 + count * 0.4, r * 1.1 + R() * (1 + t * 0.15) * Math.max(1, count / 3)); x = anchor[0] + Math.cos(a) * d; z = anchor[1] + Math.sin(a) * d; }
      if (ok(x, z, r * 0.9)) break;
    }
    if (!ok(x, z, r * 0.9) && i > 0) continue;
    const hf = spread[0] + (spread[1] - spread[0]) * R();
    const h = ((hMin + hMax) / 2) * hf;
    // 돌림: 줄은 줄 방향 기준, 무리는 넓게, 홑은 힌트 방향 ±10° — 사각 발판이면 그 돌림으로 앉혀 보고 안 되면 4방향
    const want = arrangement === 'row' ? (90 - Math.round((dir * 180) / Math.PI) + Math.round((R() - 0.5) * 30)) /* 게임 돌림 0 = +z, 90 = +x → 줄 방향을 앞으로 */ : Number.isFinite(item.rotationY) ? item.rotationY + Math.round((R() - 0.5) * (count > 1 ? 80 : 20)) : Math.round(R() * 360);
    let seat = half ? seatSpot(m, x, z, { rule, foot, h: hMax, steep: item.region?.kind === 'cliff_face', half, rot: ((want % 360) + 360) % 360 }) : seatAt(x, z);
    let rot = ((want % 360) + 360) % 360;
    if (half && !seat.ok) for (const d of [90, 180, 270, 45, 135]) { const rr = (rot + d) % 360; const t2 = seatSpot(m, x, z, { rule, foot, h: hMax, steep: item.region?.kind === 'cliff_face', half, rot: rr }); if (t2.ok) { seat = t2; rot = rr; break; } }
    if (half && !seat.ok) { seat = seatAt(x, z); rot = seat.rot ?? rot0; }
    spots.push({ x: +x.toFixed(2), z: +z.toFixed(2), heightM: +h.toFixed(2), hf: +hf.toFixed(3), dy: seat.dy || 0, rotationY: rot, assetId: item.assets[i % item.assets.length], ...(half ? { half } : {}) });
  }
  for (const s of spots) occ.push({ x: s.x, z: s.z, r });
  return { spots };
}

/**
 * 밑층(10/20) — 나무 밑동 둘레에 덤불·풀을 1~2개씩. 나무만 서 있으면 맨땅에 꽂은 막대처럼 보인다.
 * trees: 나무 자리들 · layer: { id, class, assets, sizeM, footOf } · 걷는 곳(구역·길)에는 안 놓는다
 */
export function understory(m, trees, layer, occ = [], seedBase = 1, share = 0.7) {
  const R = rng(hash32(`${seedBase}:u:${layer.id}`));
  const [hMin, hMax] = [...(layer.sizeM || [0.5, 1.2])].map(Number).sort((a, b) => a - b);
  const spots = [];
  for (const t of trees) {
    if (R() > share) continue;
    const n = 1 + (R() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = 0.9 + R() * 1.8;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      const k = idx(m, x, z); if (k < 0 || m.walk[k] || m.water[k] || m.blocked?.[k]) continue;
      if (spots.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < 0.36)) continue;
      const h = hMin + (hMax - hMin) * R();
      const assetId = layer.assets[Math.floor(R() * layer.assets.length)];
      const seat = seatSpot(m, x, z, { rule: 'plant', foot: (layer.footOf?.(assetId) ?? 0.4) * h, h });
      if (!seat.ok) continue;
      spots.push({ x: +x.toFixed(2), z: +z.toFixed(2), heightM: +h.toFixed(2), rotationY: Math.round(R() * 360), assetId, dy: seat.dy || 0 });
    }
  }
  return { spots };
}
