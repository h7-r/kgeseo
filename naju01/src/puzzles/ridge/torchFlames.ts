/**
 * 횃불 — 불꽃 · 불티 · 빛을 그린다. 진부촌 문 양옆(화면의 횃불 모형을 불꽃 없이 빌린다)과 굿판의 불 말뚝이 같이 쓴다.
 * 단위는 유닛
 */
import * as THREE from "three";

import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { M } from "../units";
import { GATE } from "./ridgeShape";

const FLAME_POINTS = 90;
/** 크게 치솟을 때 튀는 불티(횃불마다) */
const SPARKS = 36;

/** 횃불 모형에서 불꽃(밝은 뿔)만 뺀 사본 — 불꽃 뿔은 붉은 값이 거의 1, 기둥 · 감은 천은 훨씬 어둡다 */
export function stripFlame(geometry: THREE.BufferGeometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const color = source.attributes.color as THREE.BufferAttribute | undefined;
  if (!color)
    return {
      geometry: source,
      top: new THREE.Box3().setFromBufferAttribute(source.attributes.position as THREE.BufferAttribute).max.y,
    };
  const keep: number[] = [];
  for (let t = 0; t < source.attributes.position.count; t += 3) {
    if (color.getX(t) > 0.85 && color.getX(t + 1) > 0.85 && color.getX(t + 2) > 0.85) continue;
    keep.push(t, t + 1, t + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const values = attribute as THREE.BufferAttribute;
    const array = new Float32Array(keep.length * values.itemSize);
    keep.forEach((index, i) => {
      for (let k = 0; k < values.itemSize; k++)
        array[i * values.itemSize + k] = values.array[index * values.itemSize + k];
    });
    out.setAttribute(name, new THREE.BufferAttribute(array, values.itemSize));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { geometry: out, top: out.boundingBox!.max.y };
}

/** torches 는 횃불 수 — 안 주면 진부촌 문 양옆 */
export function createTorchFire(torches = GATE.torches.length) {
  const flames = makeGlowPoints(FLAME_POINTS * torches, { additive: true, softness: 1.6 });
  flames.points.visible = false;
  const sparks = makeGlowPoints(SPARKS * torches, { additive: true, softness: 1.2 });
  sparks.points.visible = false;
  return {
    flames,
    sparks,
    lights: Array.from({ length: torches }, () => new THREE.PointLight("#FF9A45", 0, 7 * M, 1.4)),
    flameSeeds: Float32Array.from({ length: FLAME_POINTS * torches * 4 }, () => Math.random()),
    sparkSeeds: Float32Array.from({ length: SPARKS * torches * 4 }, () => Math.random()),
  };
}
type TorchFire = ReturnType<typeof createTorchFire>;

/** 불의 세기 — lit 0~1 붙은 정도, big 0~1 크게 타오르는 정도, flare 치솟는 순간의 한 번 */
interface FireLevels {
  lit: number;
  big: number;
  flare: number;
}

/** 매 프레임 — 불꽃은 밑동(tops)에서 솟고, 크게 타오르면 불티가 위로 흩날린다 */
export function updateTorchFire(
  fire: TorchFire,
  tops: (THREE.Vector3 | null)[],
  time: number,
  levels: FireLevels,
  isVisible: boolean,
  gl: THREE.WebGLRenderer,
  camera: THREE.Camera,
) {
  const { lit, big, flare } = levels;
  const strength = lit * (1 + 1.6 * big + 1.2 * flare);
  const { flames, sparks, flameSeeds, sparkSeeds } = fire;
  flames.points.visible = lit > 0 && isVisible;
  if (flames.points.visible) {
    tops.forEach((top, t) => {
      if (!top) return;
      for (let k = 0; k < FLAME_POINTS; k++) {
        const i = t * FLAME_POINTS + k;
        const seed = i * 4;
        const life = 0.5 + flameSeeds[seed] * 0.45;
        const u = (time / life + flameSeeds[seed + 1]) % 1;
        const angle = flameSeeds[seed + 2] * Math.PI * 2;
        const radius = (0.02 + flameSeeds[seed + 3] * 0.07) * (1 - u * 0.7) * (0.8 + 0.9 * big);
        const sway = Math.sin(time * 6 + k) * 0.03 * u;
        flames.position.setXYZ(
          i,
          top.x + (Math.cos(angle) * radius + sway) * M,
          top.y + (0.02 + u * (0.3 + flameSeeds[seed] * 0.22) * strength) * M,
          top.z + Math.sin(angle) * radius * M,
        );
        flames.size.setX(i, (0.17 - u * 0.12) * M * strength);
        // 작을 때는 절반만 쓴다 — 크게 타오르면 나머지도 보탠다
        flames.alpha.setX(i, (1 - u) * 0.85 * lit * (k < FLAME_POINTS / 2 ? 1 : big));
        const hot = 1 - u;
        flames.color.setXYZ(i, 1.8, 0.55 + hot * 0.9, 0.12 + hot * hot * 0.6);
      }
    });
    flames.commit();
    flames.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
  }
  // 불티 — 크게 타오른 뒤 위로 튀어 바람에 흩날린다
  sparks.points.visible = big > 0 && isVisible;
  if (sparks.points.visible) {
    tops.forEach((top, t) => {
      if (!top) return;
      for (let k = 0; k < SPARKS; k++) {
        const i = t * SPARKS + k;
        const seed = i * 4;
        const life = 1.2 + sparkSeeds[seed] * 1.2;
        const u = (time / life + sparkSeeds[seed + 1]) % 1;
        const angle = sparkSeeds[seed + 2] * Math.PI * 2 + u * 3;
        const spread = u * (0.25 + sparkSeeds[seed + 3] * 0.5);
        sparks.position.setXYZ(
          i,
          top.x + Math.cos(angle) * spread * M,
          top.y + (0.3 + u * (1.4 + sparkSeeds[seed] * 1.2)) * M,
          top.z + Math.sin(angle) * spread * M,
        );
        sparks.size.setX(i, (0.035 * (1 - u) + 0.01) * M);
        sparks.alpha.setX(i, (1 - u) * big * (0.5 + 0.5 * Math.sin(time * 20 + k)));
        sparks.color.setXYZ(i, 1.9, 0.9 - u * 0.4, 0.3);
      }
    });
    sparks.commit();
    sparks.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
  }
  fire.lights.forEach((light, t) => {
    const top = tops[t];
    if (!top) return;
    light.position.set(top.x, top.y + 0.25 * M, top.z);
    light.intensity =
      lit * (1.6 + 3.2 * big + 3 * flare) * (1 + Math.sin(time * 13 + t) * 0.1 + Math.sin(time * 7.7 + t * 2) * 0.08);
  });
}
