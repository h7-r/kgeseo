// T1~T4 비탈길 — 길바닥·갓길·받침 비탈·길가 돌.
// 판정(terrain)은 중심선에서 폭/2 안쪽을 길로 친다. 길바닥 폭은 도면 폭과 정확히 같게 두고
// 갓길·비탈은 그 바깥으로만 낸다 — 보이는 길 위를 걷다가 갑자기 떨어지는 일이 없다.
// 도면 중심선은 직각으로 꺾인다. 잘게 뽑아 이웃 방향을 평균 낸 선(computeCenterline)을 써야 꺾인 데서 면이 안 파고든다.
// 좌표·크기는 미터, 지오메트리만 유닛.

import * as THREE from "three";

import { createRandom } from "@/engine/random";

import { SHOULDER_DEFAULTS, UNITS_PER_METER } from "../plan/sitePlan";
import { applyCutFaceColors, buildCutFace, EARTH_WALL_STYLE, linearStep, type BushSpot, type StoneSpot } from "./cliff";
import type { HeightAt, Noise2D } from "./ground";
// 중심선은 terrain 이 진실이다 — 그림이 판정과 같은 선을 봐야 보이는 길과 밟히는 길이 안 어긋난다
import { computeCenterline, type CenterlinePoint, type MeasuredPath } from "./terrain";

export const PATH_STYLE = {
  packed: "#A2937A", // 밟혀 다져진 한가운데 — 밝고 마른 흙
  edge: "#6B6045", // 덜 밟힌 가장자리 — 어둡고 풀이 섞인다
  shoulder: "#5E5A44",
  stone: "#8A8375",
  stoneDark: "#3E3A33",
};
// 비탈 색은 cliff 의 EARTH_WALL_STYLE — 절벽·바위 능선·길 비탈이 같은 칠하기 규칙을 타야 한 공간으로 보인다

/** terrain 이 잰 통로(measuredPaths 한 칸). centerline 이 있으면 그것을, 없으면 새로 뽑는다. */
type SlopePathInput = Parameters<typeof computeCenterline>[0] &
  Pick<MeasuredPath, "code" | "width" | "crevasse"> & { centerline?: CenterlinePoint[] };

interface PathOptions {
  path: SlopePathInput;
  spacing?: number;
  /** 길 바깥으로 흘러내리는 어깨의 폭(m) */
  shoulderWidth?: number;
  /** 그 어깨가 내려앉는 깊이(m) */
  shoulderDrop?: number;
  /** 길바닥이 흔들리는 폭(m) — 걷는 판정과 안 어긋나게 얕게 */
  bumpiness?: number;
  /** 땅보다 띄우는 양(z-파이팅 방지) */
  lift?: number;
  slopeCarveDepth?: number;
  strataThickness?: number;
  angularity?: number;
  noise: Noise2D;
  heightAt?: HeightAt;
  /** 그 자리가 남의 걷는 길인가 — 비탈 치마가 다른 길 노면을 덮지 않게 */
  otherPathAt?: ((x: number, z: number) => boolean) | null;
}

interface PathDecor {
  rocks: StoneSpot[];
  bushes: BushSpot[];
  crevasseRocks: StoneSpot[];
}

interface RibbonPoint {
  x: number;
  y: number;
  z: number;
  u: number;
  /** 0(길 안) ~ reach(갓길 끝) */
  outside: number;
  p: CenterlinePoint;
}

interface SkirtPoint {
  x: number;
  y: number;
  z: number;
  d: number;
  layerIndex: number;
  t: number;
  below: number;
}

// 감기가 맞는 쪽은 통로 방향에 달려 도면을 고치면 또 뒤집힌다. 만들 때마다 재서 위를 보게 세운다.
// 아래를 본 면은 위에서 컬링돼 안 보이다가 옆·아래에서 검은 면으로 튀어나온다.
function applyUpwardFacing(geo: THREE.BufferGeometry) {
  const n = geo.attributes.normal;
  let sum = 0;
  for (let i = 0; i < n.count; i++) sum += n.getY(i);
  if (sum >= 0) return geo;
  // 삼각형마다 둘째·셋째 꼭짓점을 맞바꾼다 = 감기를 뒤집는다
  for (const attribute of Object.values(geo.attributes)) {
    if (!(attribute instanceof THREE.BufferAttribute)) continue;
    const size = attribute.itemSize;
    const arr = attribute.array;
    for (let f = 0; f + 2 < attribute.count; f += 3)
      for (let c = 0; c < size; c++) {
        const i = (f + 1) * size + c;
        const j = (f + 2) * size + c;
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
    attribute.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildSlopePath({
  path,
  spacing = 0.4,
  shoulderWidth = 0.9,
  shoulderDrop = 0.35,
  bumpiness = 0.06,
  lift = 0.05,
  slopeCarveDepth = 0.5,
  strataThickness = 1.2,
  angularity = 0.7,
  noise,
  heightAt,
  otherPathAt = null,
}: PathOptions) {
  const line: CenterlinePoint[] = path.centerline ?? computeCenterline(path, spacing);
  const halfWidth = path.width / 2;

  const positions: number[] = [];
  const colors: number[] = [];
  // 꼭짓점마다 (진행방향 x, z, 가로자리 u). 셰이더는 자기가 길 위인지, 길이 어느 쪽으로 가는지 모른다 — 리본을 만드는 여기만 안다.
  const pathGrain: number[] = [];
  const packed = new THREE.Color(PATH_STYLE.packed);
  const edge = new THREE.Color(PATH_STYLE.edge);
  const shoulder = new THREE.Color(PATH_STYLE.shoulder);
  const c = new THREE.Color();

  // 단면 가로 위치 u: |u| ≤ 1 은 길바닥(도면 폭 그대로), 그 밖은 갓길. 바깥 끝 = 1 + reach — 판정과 같은 숫자여야 한다.
  const outerEdge = 1 + SHOULDER_DEFAULTS.reach;
  const across = [-outerEdge, -1.3, -1, -0.6, -0.2, 0.2, 0.6, 1, 1.3, outerEdge];

  const ribbonPoint = (i: number, k: number): RibbonPoint => {
    const p = line[i];
    const u = across[k];
    const outside = Math.max(0, Math.abs(u) - 1);
    const distance = Math.min(Math.abs(u), 1) * halfWidth + outside * shoulderWidth;
    const x = p.x + p.nx * distance * Math.sign(u || 1);
    const z = p.z + p.nz * distance * Math.sign(u || 1);
    // 요철은 위로만 — 아래로도 주면 땅이 노면을 뚫고 나와 길에 구멍이 난 것처럼 보인다
    const bump = (noise(x * 0.7, z * 0.7) * 0.5 + 0.5) * bumpiness * (1 - linearStep(Math.abs(u), 0.8, 1));
    // 요철 0 인 골에서도 땅보다 위에 있고 z-파이팅도 막게 더 띄운다. 갓길로 나가며 잦아들어 턱이 안 생긴다.
    const raise = lift * (1 - linearStep(Math.abs(u), 1, outerEdge));
    const design = p.y + bump + raise - shoulderDrop * Math.pow(outside / SHOULDER_DEFAULTS.reach, 1.5);
    // 갓길은 땅을 만나야 한다. 평평한 단면이면 산 쪽 갓길은 언덕에 묻히고 골 쪽은 허공에 뜬다.
    // 걷는 폭은 판정이 쓰는 설계 램프 그대로 두고, 갓길만 바깥으로 갈수록 그 자리 땅 높이로 옮겨 간다.
    let y = design;
    if (outside > 0 && heightAt) {
      const ground = heightAt(x, z);
      if (Number.isFinite(ground)) {
        // 제곱으로 눕혀 노면 쪽 이음매를 매끄럽게
        const share = Math.pow(outside / SHOULDER_DEFAULTS.reach, 1.4);
        y = design + (ground - design) * share;
      }
    }
    return { x, y, z, u, outside, p };
  };

  const colorAt = (q: RibbonPoint) => {
    if (q.outside > 0) {
      c.copy(edge).lerp(shoulder, linearStep(q.outside, 0, SHOULDER_DEFAULTS.reach));
    } else {
      // 한가운데가 가장 많이 밟힌다
      const trodden = 1 - Math.pow(Math.abs(q.u), 1.6);
      c.copy(edge).lerp(packed, trodden);
    }
    // 길을 따라 얼룩 — 통짜 띠로 안 보이게
    c.offsetHSL(0, 0, noise(q.x * 0.28 + 13, q.z * 0.28 + 7) * 0.075);
    return c;
  };

  const emit = (q: RibbonPoint) => {
    positions.push(q.x * UNITS_PER_METER, q.y * UNITS_PER_METER, q.z * UNITS_PER_METER);
    const cc = colorAt(q);
    colors.push(cc.r, cc.g, cc.b);
    // 진행 방향 = 가로 법선을 90° 돌린 것
    pathGrain.push(-q.p.nz, q.p.nx, q.u);
  };
  const face = (a: RibbonPoint, b: RibbonPoint, d: RibbonPoint) => {
    emit(a);
    emit(b);
    emit(d);
  };

  // 길바닥 + 갓길
  for (let i = 0; i < line.length - 1; i++) {
    for (let k = 0; k < across.length - 1; k++) {
      const a = ribbonPoint(i, k);
      const b = ribbonPoint(i, k + 1);
      const d = ribbonPoint(i + 1, k + 1);
      const e = ribbonPoint(i + 1, k);
      face(a, e, b);
      face(b, e, d);
    }
  }

  // 비탈(받치는 흙더미) — 갓길 바깥 끝에서 땅까지 치마를 두른다.
  // 절벽과 같은 깎인면 규칙을 세기만 눅여 태운다. 매끈한 판이면 옆 절벽과 재질이 따로 논다.
  const carve = buildCutFace({
    carveDepth: slopeCarveDepth,
    strataThickness,
    angularity,
    grainNoise: noise,
    strataNoise: noise,
    grainStrength: 0.55, // 흙은 바위만큼 또렷하게 안 쪼개진다
  });
  // 흙비탈은 깎인 면이 아니라 쌓인 면이라 배가 나와야 한다. 파임 절반만큼 미리 밀어 반은 부풀고 반은 파이게.
  const bias = slopeCarveDepth * 0.55;
  const earthBright = new THREE.Color(EARTH_WALL_STYLE.bright);
  const earthDark = new THREE.Color(EARTH_WALL_STYLE.dark);
  const earthWet = new THREE.Color(EARTH_WALL_STYLE.wet);
  const earthMoss = new THREE.Color(EARTH_WALL_STYLE.moss);

  const skirt: number[] = [];
  const skirtColors: number[] = [];
  const emitSkirt = (q: SkirtPoint) => {
    skirt.push(q.x * UNITS_PER_METER, q.y * UNITS_PER_METER, q.z * UNITS_PER_METER);
    applyCutFaceColors(
      c,
      { layerIndex: q.layerIndex, d: q.d, t: q.t, below: q.below },
      {
        palette: { bright: earthBright, dark: earthDark, wet: earthWet, moss: earthMoss },
        carveDepth: slopeCarveDepth,
        strataNoise: noise,
        mossStrength: 0.22,
      },
    );
    skirtColors.push(c.r, c.g, c.b);
  };

  // 치마의 벌림 — 길 내내 같으면 자로 그은 둑이다. 점마다 구해야 이웃 구간과 모서리가 맞는다.
  const spreadAt = (q: RibbonPoint) => 0.5 + (noise(q.x * 0.14 + 7, q.z * 0.14) * 0.5 + 0.5) * 1.6;

  const skirtRows = 5; // 나눠야 지층이 보인다
  for (let i = 0; i < line.length - 1; i++) {
    for (const sideSign of [-1, 1]) {
      const k = sideSign < 0 ? 0 : across.length - 1;
      const a = ribbonPoint(i, k);
      const b = ribbonPoint(i + 1, k);
      const groundA = heightAt ? heightAt(a.x, a.z) : 0;
      const groundB = heightAt ? heightAt(b.x, b.z) : 0;
      if (a.y - groundA < 0.15 && b.y - groundB < 0.15) continue; // 평지는 받칠 게 없다
      // 한 구간 안에서 높이차가 확 벌어지면(대지 가장자리) 거대한 삼각 지느러미가 선다 — 구역 바위가 덮는 자리다
      if (Math.abs(a.y - groundA - (b.y - groundB)) > 1.2) continue;
      // 4 m 넘는 낙차는 흙을 쌓은 게 아니라 산허리를 깎은 길이다 — 세우면 멀리서 시커먼 세로 커튼이 된다
      if (a.y - groundA > 4 || b.y - groundB > 4) continue;
      // T4 스위치백은 위·아래 다리가 겹쳐 지나간다. 발치가 남의 길 걷는 폭에 떨어지면 그 기둥은 건너뛴다.
      if (otherPathAt) {
        const footAt = (q: RibbonPoint) => {
          const spread = spreadAt(q);
          return { x: q.x + q.p.nx * spread * sideSign, z: q.z + q.p.nz * spread * sideSign };
        };
        const fa = footAt(a);
        const fb = footAt(b);
        if (otherPathAt(fa.x, fa.z) || otherPathAt(fb.x, fb.z)) continue;
      }

      // v = 0(갓길 끝) ~ 1(땅바닥)
      const skirtPoint = (end: 0 | 1, v: number): SkirtPoint => {
        const q = end === 0 ? a : b;
        const ground = end === 0 ? groundA : groundB;
        const spread = spreadAt(q);
        // 아래로 갈수록 눕는다 — 곧은 빗변이 아니라 발치가 퍼진 언덕
        const outward = spread * Math.pow(v, 0.62);
        const x0 = q.x + q.p.nx * outward * sideSign;
        const z0 = q.z + q.p.nz * outward * sideSign;
        const y = q.y + (ground - q.y) * v;
        const r = carve(x0, y, z0);
        const dd = (r.d - bias) * Math.sin(Math.PI * Math.min(1, v * 1.05)); // 위·아래 이음매는 0
        return {
          x: x0 - q.p.nx * dd * sideSign,
          y,
          z: z0 - q.p.nz * dd * sideSign,
          d: dd,
          layerIndex: r.layerIndex,
          t: r.t,
          below: v,
        };
      };

      for (let j = 0; j < skirtRows; j++) {
        const v0 = j / skirtRows;
        const v1 = (j + 1) / skirtRows;
        const P = [skirtPoint(0, v0), skirtPoint(1, v0), skirtPoint(1, v1), skirtPoint(0, v1)];
        const order = sideSign < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        // 넓이 0 인 삼각형은 버린다 — 길이 0 법선이 나와 조명을 아무리 올려도 새까만 띠로 남는다
        for (let t = 0; t < order.length; t += 3) {
          const p1 = P[order[t]];
          const p2 = P[order[t + 1]];
          const p3 = P[order[t + 2]];
          const ux = p2.x - p1.x;
          const uy = p2.y - p1.y;
          const uz = p2.z - p1.z;
          const wx = p3.x - p1.x;
          const wy = p3.y - p1.y;
          const wz = p3.z - p1.z;
          const area = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
          if (area < 1e-4) continue;
          emitSkirt(p1);
          emitSkirt(p2);
          emitSkirt(p3);
        }
      }
    }
  }

  // 비탈에 놓을 바위·덤불 자리.
  // 절벽(암반)과 길 비탈(흙)이 딱 잘려 보이는 게 이질감의 뿌리다. 같은 돌을 흩어 두 재질을 물려 넣는다.
  const decor: PathDecor = { rocks: [], bushes: [], crevasseRocks: [] };
  {
    const random = createRandom(path.code.charCodeAt(1) * 7919 + 12345);
    // 「바위틈」 — 걷는 폭 바깥 양옆에 큰 바위를 세워 좁은 틈으로 만든다
    if (path.crevasse) {
      const crevasse = path.crevasse;
      for (let i = 0; i < line.length; i += 2) {
        for (const sideSign of [-1, 1]) {
          if (random() > 0.72) continue;
          const q = line[i];
          const distance = halfWidth + crevasse.inner + random() * (crevasse.outer - crevasse.inner);
          const size = crevasse.size[0] + Math.pow(random(), 1.5) * (crevasse.size[1] - crevasse.size[0]);
          const bx = q.x + q.nx * distance * sideSign;
          const bz = q.z + q.nz * distance * sideSign;
          decor.crevasseRocks.push({
            x: bx,
            z: bz,
            // 밑동이 땅에 묻히게 — 더 띄우면 큰 돌이 뜬다
            y: (heightAt ? heightAt(bx, bz) : 0) + size * 0.06,
            size,
          });
        }
      }
    }

    for (let i = 0; i < line.length; i += 2) {
      for (const sideSign of [-1, 1]) {
        const k = sideSign < 0 ? 0 : across.length - 1;
        const q = ribbonPoint(i, k);
        const ground = heightAt ? heightAt(q.x, q.z) : 0;
        if (q.y - ground < 0.4) continue;
        const pick = random();
        const v = 0.15 + random() * 0.75; // 비탈 위 어디쯤
        const outward = spreadAt(q) * Math.pow(v, 0.62);
        const x = q.x + q.p.nx * outward * sideSign;
        const z = q.z + q.p.nz * outward * sideSign;
        const y = q.y + (ground - q.y) * v;
        // 높이는 돌이 실제로 놓인 자리의 땅에서 다시 잰다 — 치마 보간 값을 쓰면 최대 5 m 떴다
        const base = heightAt ? heightAt(x, z) : y;
        // 가파른 데는 바위, 완만한 데는 덤불
        if (pick < 0.34) {
          const size = 0.2 + Math.pow(random(), 2) * 1.1;
          // 살짝 파묻어야 박힌 것으로 보인다
          decor.rocks.push({ x, y: base - size * 0.22, z, size });
        } else if (pick < 0.56) {
          decor.bushes.push({ x, y: base, z, size: 0.7 + random() * 1.6 });
        }
      }
    }
  }

  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  pathGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  // three 가 속성 이름을 GLSL attribute 선언에 그대로 넣는다 — ASCII 여야 한다(groundGrain.ts 와 짝)
  pathGeo.setAttribute("pathGrain", new THREE.Float32BufferAttribute(pathGrain, 3));
  pathGeo.computeVertexNormals();
  applyUpwardFacing(pathGeo);

  let slopeGeo: THREE.BufferGeometry | null = null;
  if (skirt.length) {
    slopeGeo = new THREE.BufferGeometry();
    slopeGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirt, 3));
    slopeGeo.setAttribute("color", new THREE.Float32BufferAttribute(skirtColors, 3));
    slopeGeo.computeVertexNormals();
  }
  return { path: pathGeo, slope: slopeGeo, centerline: line, decor };
}

interface RoadsideStoneOptions {
  lines: { centerline: CenterlinePoint[]; halfWidth: number }[];
  density?: number;
  seed: number;
  shoulderWidth?: number;
  /** 반드시 넘긴다 — 중심선 높이를 쓰면 옆으로 민 돌이 갓길·산허리 위 공중에 뜬다 */
  heightAt?: HeightAt;
}

/**
 * 길 바깥(갓길 쪽)에만 놓는 길가 돌 자리. 길 위에 놓으면 걷다가 통과한다.
 * 인스턴스로 심으려고 자리만 뽑는다. 시드와 난수 순서가 손 배치(edits.json)에 묶여 있다.
 */
export function computeRoadsideStoneSpots({
  lines,
  density = 0.55,
  seed,
  shoulderWidth = 0.9,
  heightAt,
}: RoadsideStoneOptions) {
  const random = createRandom(seed);
  const spots: StoneSpot[] = [];
  for (const { centerline, halfWidth } of lines) {
    for (let i = 0; i < centerline.length; i++) {
      if (random() > density) continue;
      const p = centerline[i];
      const sideSign = random() < 0.5 ? -1 : 1;
      const distance = halfWidth + 0.12 + random() * shoulderWidth;
      const x = p.x + p.nx * distance * sideSign;
      const z = p.z + p.nz * distance * sideSign;
      const size = 0.1 + Math.pow(random(), 2.4) * 0.42;
      const flatness = 0.5 + random() * 0.35;
      // 모양·회전·크기·색 몫의 난수 — 안 굴리면 뒤 돌 자리가 전부 밀린다
      random();
      random();
      random();
      random();
      random();
      const base = heightAt ? heightAt(x, z) : p.y;
      spots.push({ x, y: base - size * flatness * 0.35, z, size });
    }
  }
  return spots;
}
