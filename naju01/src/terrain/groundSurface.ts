// 이 맵의 땅 표면을 정하는 하나뿐인 함수(해석식 지형).
// 구역마다 제 소음으로 판을 흔들면 맞닿는 선에 단차가 남는다. 모든 조각이 여기를 조회하면 맞닿는 값이 애초에 같다.
// 걷는 높이는 여전히 terrain.groundAt(x, z).y 이고, 여기서 더하는 요철은 ±0.12 m 안이라 눈과 발이 안 어긋난다.
// 결(재질)을 고를 때는 좌표를 소음으로 흔들어 물어 보이는 경계만 들쭉날쭉하게 한다. 단위는 전부 미터.

import * as THREE from "three";

import { RIVER } from "../plan/sitePlan";
import { createNoise, GROUND_STYLE, type GroundStyle, type GroundStyleCode } from "./ground";
import type { Terrain } from "./terrain";

interface GroundSurfaceOptions {
  terrain: Pick<Terrain, "zones" | "groundAt">;
  bumpScale?: number;
  seed?: number;
}

export function createGroundSurface({ terrain, bumpScale = 1, seed = 20260908 }: GroundSurfaceOptions) {
  const grainNoise = createNoise(seed);
  const mottleNoise = createNoise(seed + 7711);
  const patternNoise = createNoise(seed + 4451);
  const edgeNoise = createNoise(seed + 9137);

  /** 이 자리는 무슨 땅인가. 좌표를 흔들어 물으므로 구역 경계가 들쭉날쭉하다. */
  const styleCodeAt = (x: number, z: number): GroundStyleCode => {
    const wobble = 1.6;
    const hx = x + edgeNoise(x * 0.16, z * 0.16) * wobble;
    const hz = z + edgeNoise(x * 0.16 + 40, z * 0.16 + 40) * wobble;
    for (const zone of terrain.zones)
      if (hx >= zone.x[0] && hx <= zone.x[1] && hz >= zone.z[0] && hz <= zone.z[1]) return zone.code;
    return "undesigned";
  };
  const styleAt = (x: number, z: number): GroundStyle => GROUND_STYLE[styleCodeAt(x, z)];

  // 결마다 세기·주기가 달라도 소음은 하나 — 결이 바뀌는 자리에서도 높이가 이어진다.
  const bumpAt = (x: number, z: number) => {
    const style = styleAt(x, z);
    if (!style || style.bump <= 0) return 0;
    return grainNoise(x * style.grainScale, z * style.grainScale) * style.bump * bumpScale;
  };

  /** 걷는 높이(도면) + 보이는 요철 */
  const heightAt = (x: number, z: number) => terrain.groundAt(x, z).y + bumpAt(x, z);

  // 산허리에는 50° 넘는 사면이 있는데 결은 구역으로만 정해져 비탈이 통째로 잔디색이 된다.
  // 각도로 재서 색과 알갱이만 바꾼다 — 높이는 안 건드린다(판정 불변).
  const slopeAt = (x: number, z: number) => {
    const e = 0.9;
    const dx = (terrain.groundAt(x + e, z).y - terrain.groundAt(x - e, z).y) / (2 * e);
    const dz = (terrain.groundAt(x, z + e).y - terrain.groundAt(x, z - e).y) / (2 * e);
    return Math.hypot(dx, dz);
  };
  /** 0(평지) ~ 1(못 붙는 급사면). tan 27° ≈ 0.5 부터 드러난다 */
  const steepnessAt = (x: number, z: number) => THREE.MathUtils.smoothstep(slopeAt(x, z), 0.5, 1.15);
  // 급사면에 드러나는 마른 흙과 부스러진 돌(절벽 팔레트 계열)
  const bareSoil = new THREE.Color("#8A7C63");
  const bareSoilShade = new THREE.Color("#4C4437");

  /** 요철이 파일 수 있는 최대 깊이 — 아래 덩어리를 얼마나 낮출지 정할 때 쓴다 */
  const maxBump = Math.max(...Object.values(GROUND_STYLE).map((s) => s.bump)) * bumpScale;

  const out = new THREE.Color();
  const baseColor = new THREE.Color();
  // 물에 잠겼다 드러나는 젖은 띠. 경계를 소음으로 흔들어야 뭍과 물이 직선으로 안 갈린다.
  const wetColor = new THREE.Color("#4E5348");
  const waterlineAt = (x: number) => RIVER.zStart - 2.2 + edgeNoise(x * 0.11, 3.3) * 1.9;

  /** 굴곡 그늘 + 두 재질 무늬 + 잔얼룩. 돌려주는 색은 다음 호출이 덮어쓰는 같은 객체다. */
  const colorAt = (x: number, z: number, contactShade = 0) => {
    const style = styleAt(x, z);
    const light = new THREE.Color(style.color);
    const light2 = new THREE.Color(style.color2);
    const dark = new THREE.Color(style.shade);
    const pattern = THREE.MathUtils.clamp(0.5 + patternNoise(x * 0.06, z * 0.06) * 1.3, 0, 1);
    baseColor.copy(light2).lerp(light, pattern);
    const span = Math.max(1e-4, style.bump * bumpScale);
    const depth = THREE.MathUtils.clamp(bumpAt(x, z) / span, -1, 1);
    out.copy(dark).lerp(baseColor, 0.7 + depth * 0.26);
    out.lerp(dark, contactShade * 0.3);
    // 가파를수록 풀이 없어지고 흙·돌이 드러난다
    const steep = steepnessAt(x, z);
    if (steep > 0) out.lerp(bareSoil.clone().lerp(bareSoilShade, contactShade * 0.4), steep * 0.85);
    // 물가로 갈수록 젖는다
    const waterline = waterlineAt(x);
    if (z > waterline) out.lerp(wetColor, THREE.MathUtils.clamp((z - waterline) / 2.6, 0, 1) * 0.7);
    const e1 = mottleNoise(x * 0.24, z * 0.24) * style.mottle;
    const e2 = mottleNoise(x * 0.37 + 53, z * 0.37 + 91) * style.mottle;
    out.setRGB(
      THREE.MathUtils.clamp(out.r + e1, 0, 1),
      THREE.MathUtils.clamp(out.g + e1 * 0.5 + e2 * 0.5, 0, 1),
      THREE.MathUtils.clamp(out.b + e2, 0, 1),
    );
    return out;
  };

  /** 요철이 얕아 실제 기울기는 거의 0 이라 빛이 굴곡을 읽게 과장한다(텍스처 없는 범프). */
  const normalAt = (x: number, z: number, exaggeration = 5): [number, number, number] => {
    const e = 0.3;
    const dx = (bumpAt(x + e, z) - bumpAt(x - e, z)) * exaggeration;
    const dz = (bumpAt(x, z + e) - bumpAt(x, z - e)) * exaggeration;
    const length = Math.hypot(dx, 2 * e, dz) || 1;
    return [-dx / length, (2 * e) / length, -dz / length];
  };

  return {
    styleCodeAt,
    styleAt,
    bumpAt,
    heightAt,
    colorAt,
    normalAt,
    maxBump,
    slopeAt,
    steepnessAt,
    noise: { grain: grainNoise, mottle: mottleNoise, pattern: patternNoise, edge: edgeNoise },
  };
}

export type GroundSurface = ReturnType<typeof createGroundSurface>;
