// 하늘돔(천정 → 지평 그라데이션)과 구름.
// 단색 하늘은 지평선이 안 보이고, 건너편 뱃길이 오려 붙인 종이처럼 뜬다.
// 둘 다 빛·안개를 안 받는 평면 색이고, 카메라를 따라다닌다 — 고정하면 무대 끝에서 돔 밖으로 나가 하늘이 잘린다.
// 반지름은 미터, 지오메트리만 유닛.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { makeRandom } from "@/engine/random";

import { UNITS_PER_METER } from "../plan/sitePlan";

interface SkyPalette {
  zenith: string;
  middle: string;
  horizon: string;
}

export const SKY_STYLE: SkyPalette = {
  zenith: "#4A6E96",
  middle: "#8FA6B8",
  horizon: "#CFCBBE", // 공기가 두껍게 쌓인 쪽이라 늘 흐리고 밝다
};

interface CloudOptions {
  radius?: number;
  count?: number;
  seed?: number;
  palette?: SkyPalette;
}

// 가깝게(150 m) 잡으면 한 덩이가 하늘의 4분의 1을 덮어 흰 파편이 된다. 멀리 두고 작게.
export function buildClouds({ radius = 520, count = 30, seed = 4242, palette = SKY_STYLE }: CloudOptions = {}) {
  const random = makeRandom(seed);
  const pieces: THREE.BufferGeometry[] = [];
  const bright = new THREE.Color("#F2F0E8");
  const base = new THREE.Color(palette.horizon);
  const c = new THREE.Color();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    // 머리 위보다 지평 쪽에 몰아 둔다
    const azimuth = random() * Math.PI * 2;
    const elevation = (5 + Math.pow(random(), 2.0) * 30) * (Math.PI / 180);
    const r0 = radius * (0.8 + random() * 0.4);
    const cx = Math.cos(azimuth) * Math.cos(elevation) * r0;
    const cy = Math.sin(elevation) * r0;
    const cz = Math.sin(azimuth) * Math.cos(elevation) * r0;
    const width = 26 + random() * 54;
    // 뭉치를 많고 작게 — 하나면 그냥 타원이다
    const puffs = 5 + Math.floor(random() * 6);
    for (let k = 0; k < puffs; k++) {
      const g = new THREE.IcosahedronGeometry(0.5 * UNITS_PER_METER, 1);
      const r = width * (0.2 + random() * 0.32);
      quaternion.setFromEuler(new THREE.Euler(random(), random() * 6.3, random()));
      scale.set(
        r * UNITS_PER_METER,
        r * (0.4 + random() * 0.3) * UNITS_PER_METER,
        r * (0.7 + random() * 0.4) * UNITS_PER_METER,
      );
      position.set(
        (cx + (random() - 0.5) * width * 1.3) * UNITS_PER_METER,
        (cy + (random() - 0.5) * width * 0.12) * UNITS_PER_METER,
        (cz + (random() - 0.5) * width * 1.3) * UNITS_PER_METER,
      );
      matrix.compose(position, quaternion, scale);
      g.applyMatrix4(matrix);
      // 아래는 지평 색, 위는 밝게 — 그것만으로 부피가 생긴다
      c.copy(base).lerp(bright, 0.45 + random() * 0.5);
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        const up = (g.attributes.position.getY(v) - position.y) / (r * UNITS_PER_METER) + 0.5;
        const cc = base.clone().lerp(c, THREE.MathUtils.clamp(up * 1.4, 0.25, 1));
        colors[v * 3] = cc.r;
        colors[v * 3 + 1] = cc.g;
        colors[v * 3 + 2] = cc.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      pieces.push(g);
    }
  }
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

export function buildSkyDome({ radius = 185, palette = SKY_STYLE }: { radius?: number; palette?: SkyPalette } = {}) {
  const g = new THREE.SphereGeometry(radius * UNITS_PER_METER, 24, 16);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const zenith = new THREE.Color(palette.zenith);
  const middle = new THREE.Color(palette.middle);
  const horizon = new THREE.Color(palette.horizon);
  const c = new THREE.Color();
  const r = radius * UNITS_PER_METER;

  for (let i = 0; i < p.count; i++) {
    const h = THREE.MathUtils.clamp(p.getY(i) / r, -1, 1); // -1(아래) ~ 1(천정)
    if (h >= 0) {
      // 제곱근이라야 지평 쪽 띠가 얇지 않고 넉넉하다
      const t = Math.sqrt(h);
      c.copy(horizon).lerp(middle, Math.min(1, t * 2));
      if (t > 0.5) c.lerp(zenith, (t - 0.5) * 2);
    } else {
      // 땅에 가리지만 먼 물 너머로 비칠 때를 위해 살짝 어둡게
      c.copy(horizon).lerp(new THREE.Color("#6E6A60"), Math.min(1, -h * 2.2));
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}
