// 영산강 — 수면·물가 돌·건너편 능선, 그리고 강 굽이 함수.
// 강은 방향 앵커다. 어디가 남쪽인지 알려 주는 유일한 지형지물이라 파란 판 한 장으로는 안 된다.
// 수면은 성긴 격자(1 m 당 0.6칸)로 충분하다. 물결은 CPU 가 매 프레임 다시 쓴다.
// 좌표·크기는 미터, 지오메트리만 유닛.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRandom } from "@/engine/random";
import { applyVertexColors, createRockShape, type Noise2D } from "../terrain/ground";
import { UNITS_PER_METER } from "../plan/sitePlan";
import type { WaterDistortion } from "../story/distortion";

type Range = [number, number];

const RIVER_STYLE = {
  shallow: "#6E8A86", // 물가 — 바닥이 비쳐 밝고 탁하다
  deep: "#2E4A5C",
  crest: "#93AFAE", // 물결 꼭대기
  bankStone: "#7A756B",
  bankStoneDark: "#403C35",
  farBank: "#59616B", // 원경 — 공기에 씻겨 파랗고 흐리다
};

// 코어 앞(X 0~80 ± 60 m)은 물가를 곧게 둔다 — 걷는 판정의 물 경계가 직선이라 그림도 맞춘다.
export const riverBendAt = (x: number) => {
  const amplitude = THREE.MathUtils.clamp((Math.abs(x - 40) - 60) / 140, 0, 1);
  return amplitude * (28 * Math.sin(x * 0.011 + 0.8) + 12 * Math.sin(x * 0.027 + 2));
};

// 코어 한복판(x=40)에서 0 이 되게 기준값을 뺀다. 그래야 RIVER.farBankWidth 가 곧 눈에 보이는 강폭이다.
const FAR_BANK_BASELINE = 18 * Math.sin(40 * 0.014 + 1.3);
export const farBankBendAt = (x: number) => 18 * Math.sin(x * 0.014 + 1.3) - FAR_BANK_BASELINE + riverBendAt(x);

interface RiverSurfaceOptions {
  x: Range;
  zStart: number;
  zEnd: number;
  cellsPerMeter?: number;
  waveHeight?: number;
}

/** 수면. `update(time)` 을 매 프레임 부르면 물결이 움직인다. */
export function buildRiverSurface({ x: X, zStart, zEnd, cellsPerMeter = 0.6, waveHeight = 0.09 }: RiverSurfaceOptions) {
  const w = X[1] - X[0];
  const d = zEnd - zStart;
  const nx = Math.max(2, Math.round(w * cellsPerMeter));
  const nz = Math.max(2, Math.round(d * cellsPerMeter));
  const geo = new THREE.PlaneGeometry(w * UNITS_PER_METER, d * UNITS_PER_METER, nx, nz);
  geo.rotateX(-Math.PI / 2);

  const p = geo.attributes.position;
  const count = p.count;
  // 월드 좌표(미터)를 들고 있어 매 프레임 다시 계산하지 않는다
  const gx = new Float32Array(count);
  const gz = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const cx = (X[0] + X[1]) / 2;
  const cz = (zStart + zEnd) / 2;
  const shallow = new THREE.Color(RIVER_STYLE.shallow);
  const deep = new THREE.Color(RIVER_STYLE.deep);
  const c = new THREE.Color();
  // 넓은 얼룩 — 한 톤이면 파란 판이 된다
  const blotch = (x: number, z: number) =>
    Math.sin(x * 0.035 + 1.7) * Math.sin(z * 0.028 + 0.4) * 0.5 + Math.sin(x * 0.011 - z * 0.017) * 0.5;

  for (let i = 0; i < count; i++) {
    gx[i] = p.getX(i) / UNITS_PER_METER + cx;
    gz[i] = p.getZ(i) / UNITS_PER_METER + cz;
    // 이쪽 물가는 riverBendAt, 저쪽 물가는 farBankBendAt, 사이는 섞는다
    {
      const t = THREE.MathUtils.clamp((gz[i] - zStart) / Math.max(0.01, d), 0, 1);
      gz[i] += riverBendAt(gx[i]) * (1 - t) + farBankBendAt(gx[i]) * t;
      p.setZ(i, (gz[i] - cz) * UNITS_PER_METER);
    }
    // 물가에서 멀어질수록 깊어진다 — 이 색 하나가 물가를 만든다
    const depth = THREE.MathUtils.clamp((gz[i] - zStart - riverBendAt(gx[i])) / Math.max(0.01, d), 0, 1);
    c.copy(shallow).lerp(deep, Math.pow(depth, 0.6));
    c.offsetHSL(0, 0, blotch(gx[i], gz[i]) * 0.045);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.translate(cx * UNITS_PER_METER, 0, cz * UNITS_PER_METER);

  const crest = new THREE.Color(RIVER_STYLE.crest);
  const baseColors = colors.slice(); // 마루를 덧칠하기 전 색
  const temp = new THREE.Color();
  const normals = new Float32Array(count * 3);
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  // 방향·주기가 다른 잔물결 셋 — 하나면 빨래판이다.
  // 법선은 computeVertexNormals 대신 미분으로 — 꼭짓점 수만큼만 돌아 훨씬 싸다.
  const A = [0.5, 0.32, 0.18];
  // distortion 이 null 이면 왜곡 없던 때와 한 프레임도 다르지 않다
  const update = (time: number, distortion: WaterDistortion | null = null) => {
    // 너울만 거꾸로 간다. 같이 뒤집으면 그냥 반대로 흐르는 강이지 어긋남이 아니다.
    const flip = distortion ? distortion.swellReversal : 0;
    const swellSpeed = -0.28 * (1 - 2 * flip);
    const drag = distortion ? distortion.sideDrag : 0;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const nor = geo.attributes.normal;
    for (let i = 0; i < count; i++) {
      const x = gx[i];
      const z = gz[i];
      const p1 = x * 0.55 + time * 0.9;
      const p2 = z * 0.9 - time * 1.35 + x * (0.15 + drag);
      const p3 = (x + z) * 1.7 + time * 2.1;
      // 너울 — 잔물결만 있으면 떨리는 판으로 보인다
      const p0 = z * 0.06 + time * swellSpeed + x * 0.02;
      const h = Math.sin(p0) * 1.15 + A[0] * Math.sin(p1) + A[1] * Math.sin(p2) + A[2] * Math.sin(p3);
      pos.setY(i, h * waveHeight * UNITS_PER_METER);

      // 얕은 물결이라 기울기를 조금 과장해야 빛이 읽는다
      const dx =
        (1.15 * 0.02 * Math.cos(p0) +
          A[0] * 0.55 * Math.cos(p1) +
          A[1] * (0.15 + drag) * Math.cos(p2) +
          A[2] * 1.7 * Math.cos(p3)) *
        waveHeight *
        3.5;
      const dz =
        (1.15 * 0.06 * Math.cos(p0) + A[1] * 0.9 * Math.cos(p2) + A[2] * 1.7 * Math.cos(p3)) * waveHeight * 3.5;
      const length = Math.hypot(dx, 1, dz) || 1;
      nor.setXYZ(i, -dx / length, 1 / length, -dz / length);

      // 마루는 하늘빛을 받아 밝다
      const t = THREE.MathUtils.clamp(h * 0.32 + 0.5, 0, 1);
      temp.setRGB(baseColors[i * 3], baseColors[i * 3 + 1], baseColors[i * 3 + 2]);
      temp.lerp(crest, Math.pow(t, 2.5) * 0.55);
      col.setXYZ(i, temp.r, temp.g, temp.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    nor.needsUpdate = true;
  };

  update(0);
  return { geometry: geo, update };
}

interface RiverbankOptions {
  x: Range;
  zStart: number;
  width?: number;
  count: number;
  seed: number;
  canPlace?: (x: number, z: number) => boolean;
}

// 물가 선이 자로 그은 듯 곧으면 판을 잘라 붙인 것으로 보인다. 돌을 걸쳐 흐트러뜨린다.
export function buildRiverbank({ x: X, zStart, width = 2.2, count, seed, canPlace }: RiverbankOptions) {
  const random = makeRandom(seed);
  const shapes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) shapes.push(createRockShape(random));
  const pieces: THREE.BufferGeometry[] = [];
  const bright = new THREE.Color(RIVER_STYLE.bankStone);
  const dark = new THREE.Color(RIVER_STYLE.bankStoneDark);
  const color = new THREE.Color();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const x = X[0] + random() * (X[1] - X[0]);
    // 물가 선 앞뒤로 흩는다 — 절반은 물에 잠긴다
    const z = zStart + (random() - 0.45) * width;
    const size = 0.15 + Math.pow(random(), 2.6) * 0.9;
    const flatness = 0.45 + random() * 0.35;
    const rotation = [(random() - 0.5) * 0.8, random() * Math.PI * 2, (random() - 0.5) * 0.8];
    const tint = random();
    if (canPlace && !canPlace(x, z)) continue;

    const g = shapes[Math.floor(random() * shapes.length)].clone();
    quaternion.setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]));
    scale.set(
      size * UNITS_PER_METER,
      size * flatness * UNITS_PER_METER,
      size * (0.7 + random() * 0.6) * UNITS_PER_METER,
    );
    // 물 쪽으로 갈수록 더 깊이 잠긴다
    const sunk = THREE.MathUtils.clamp((z - zStart) / width, -0.5, 1);
    position.set(x * UNITS_PER_METER, size * flatness * (0.25 - sunk * 0.5) * UNITS_PER_METER, z * UNITS_PER_METER);
    matrix.compose(position, quaternion, scale);
    g.applyMatrix4(matrix);
    color.copy(dark).lerp(bright, 0.35 + tint * 0.6);
    pieces.push(applyVertexColors(g, color));
  }

  shapes.forEach((g) => g.dispose());
  if (!pieces.length) return null;
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

interface FarBankOptions {
  x: Range;
  z: number;
  layers?: number;
  noise: Noise2D;
  horizonColor?: string;
}

interface Tree {
  x: number;
  width: number;
  height: number;
}

// 건너편 능선(원경). 높이가 17 m 넘어 택촌 초가를 가리므로 씬은 택촌 뒤에 세운다.
// 겹마다 30 m 씩 물러나며 지평색으로 옅어진다 — 겹만으로 깊이가 생긴다.
export function buildFarBank({ x: X, z: Z, layers = 4, noise, horizonColor = "#CFCBBE" }: FarBankOptions) {
  const pieces: THREE.BufferGeometry[] = [];
  const near = new THREE.Color(RIVER_STYLE.farBank);
  const horizon = new THREE.Color(horizonColor);
  const c = new THREE.Color();

  for (let layer = 0; layer < layers; layer++) {
    const t = layer / Math.max(1, layers - 1); // 0(가까움) ~ 1(멂)
    const z = Z + layer * 30;
    const width = X[1] - X[0] + layer * 110;
    const x0 = X[0] - layer * 55;
    const bottom = -3;
    const n = 150; // 촘촘해야 나무 실루엣이 나무로 보인다
    const positions: number[] = [];
    const colors: number[] = [];
    c.copy(near).lerp(horizon, 0.25 + t * 0.62);

    // 가장 가까운 겹은 건너편 물가 — 낮은 둔덕 위 나무 줄이 있어야 사람 사는 물가로 읽힌다
    const isTreeLayer = layer === 0;
    const trees: Tree[] = [];
    if (isTreeLayer) {
      // 봉우리가 넓으면 둥근 둔덕이 늘어선 것처럼 뭉툭해진다 — 가늘고 촘촘하게
      let x = x0;
      while (x < x0 + width) {
        const r = noise(x * 0.9, 9.1) * 0.5 + 0.5;
        const r2 = noise(x * 0.21 + 40, 3.3) * 0.5 + 0.5;
        trees.push({ x, width: 0.7 + r * 1.5, height: 2.6 + r * 3.2 + r2 * 4.5 });
        x += 0.9 + r * 1.9;
      }
    }

    const heightAt = (x: number) => {
      let h = (noise(x * 0.018 + layer * 7, layer * 3) * 0.5 + 0.5) * (6 + layer * 9) + 2 + layer * 3;
      if (isTreeLayer) {
        h = 2.5 + (noise(x * 0.05, 4) * 0.5 + 0.5) * 2.5;
        // 겹치는 둥근 혹으로 나무 줄을 만든다
        for (const tree of trees) {
          const d = Math.abs(x - tree.x) / tree.width;
          if (d < 1) h = Math.max(h, 2.5 + tree.height * Math.sqrt(1 - d * d));
        }
      }
      return h;
    };

    for (let i = 0; i < n; i++) {
      const xa = x0 + (width * i) / n;
      const xb = x0 + (width * (i + 1)) / n;
      const ha = heightAt(xa);
      const hb = heightAt(xb);
      const za = z + farBankBendAt(xa);
      const zb = z + farBankBendAt(xb);
      // 보는 사람은 강 이쪽(−Z)에 있으므로 법선이 −Z 를 봐야 한다
      const points = [
        [xa, bottom, za],
        [xb, hb, zb],
        [xb, bottom, zb],
        [xa, bottom, za],
        [xa, ha, za],
        [xb, hb, zb],
      ];
      for (const [px, py, pz] of points) {
        positions.push(px * UNITS_PER_METER, py * UNITS_PER_METER, pz * UNITS_PER_METER);
        colors.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    pieces.push(g);
  }
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}
