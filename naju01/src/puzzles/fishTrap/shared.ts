/** 통발 퍼즐과 화톳불이 같이 쓰는 자리·색·빛점 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { UNITS_PER_METER } from "../../plan/sitePlan";
import { DEFAULT_TERRAIN } from "../../terrain/terrain";

export const M = UNITS_PER_METER;

/** 물가 화톳불(씬1 화톳불 0번) — 미터 */
export const HEARTH = { x: 23.991, z: 42.503 };
/** 아비사 자리 */
export const ABISA = { x: 22, z: 38.5 };

/**
 * 연기 화살표가 이끄는 길 — 미터. 천막 서쪽 → 아비사 뒤 → T1 「바위틈」 → 씬2 「바위 아래」(Z2).
 * 첫 점에서 흩어진 글씨가 모여 화살표가 된다. 천막(x 22.5~25.5 · z 39.9~44.1)과 아비사를 비켜 간다.
 * 바위틈 안(z 36.5)은 교체된 큰 바위가 메워 걸어 지날 수 없어, 그 남쪽 틈(z ≈ 39.5)으로 간다.
 */
export const GUIDE_PATH: [number, number][] = [
  [21.8, 41.0],
  [22.0, 39.4],
  [25.0, 38.7],
  [27.5, 38.9],
  [30.0, 39.4],
  [33.0, 39.5],
  [35.5, 39.6],
  [38.0, 40.0],
];
/** 화살표가 떠 가는 높이(미터) — 눈높이(1.25)보다 조금 위라 앞을 볼 때 걸린다 */
export const GUIDE_HEIGHT = 1.5;

export const EMBER = new THREE.Color("#FFA24A");

export const groundY = (x: number, z: number) => DEFAULT_TERRAIN.groundAt(x, z).y;

// 로그 깊이 버퍼를 쓰는 씬이라 직접 쓴 셰이더도 그 조각을 넣어야 깊이가 맞는다
const GLOW_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPointScale;
  varying float vAlpha;
  varying vec3 vColor;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uPointScale / max(0.001, -mvPosition.z);
    #include <logdepthbuf_vertex>
  }
`;
const GLOW_FRAGMENT = /* glsl */ `
  uniform float uSoftness;
  varying float vAlpha;
  varying vec3 vColor;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(smoothstep(1.0, 0.0, d), uSoftness) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

export interface GlowPoints {
  points: THREE.Points;
  position: THREE.BufferAttribute;
  size: THREE.BufferAttribute;
  alpha: THREE.BufferAttribute;
  color: THREE.BufferAttribute;
  material: THREE.ShaderMaterial;
  count: number;
  /** 고친 속성을 GPU 로 올린다 */
  commit(): void;
}

/**
 * 점마다 크기(미터)·투명도·색을 따로 주는 부드러운 원. 불·불씨는 더해 칠하고(additive),
 * 연기는 덮어 칠한다(normal) — 연기를 더해 칠하면 밝은 하늘에서 하얗게 날아가 글자가 안 읽힌다.
 */
export function makeGlowPoints(count: number, options: { additive: boolean; softness?: number }): GlowPoints {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const size = new THREE.BufferAttribute(new Float32Array(count), 1);
  const alpha = new THREE.BufferAttribute(new Float32Array(count), 1);
  const color = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aSize", size);
  geometry.setAttribute("aAlpha", alpha);
  geometry.setAttribute("aColor", color);
  const material = new THREE.ShaderMaterial({
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    uniforms: { uPointScale: { value: 600 }, uSoftness: { value: options.softness ?? 2 } },
    transparent: true,
    depthWrite: false,
    blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    points,
    position,
    size,
    alpha,
    color,
    material,
    count,
    commit() {
      position.needsUpdate = true;
      size.needsUpdate = true;
      alpha.needsUpdate = true;
      color.needsUpdate = true;
    },
  };
}

/** 화면 높이에 맞춘 점 크기 배율 — 점 크기를 미터로 줄 수 있게 */
export function pointScaleFor(gl: THREE.WebGLRenderer, camera: THREE.Camera) {
  const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
  return gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
}

/** 통발을 굴려 넣는 물길과 밧줄이 걸리는 말뚝 쪽까지(미터) — 물가 돌을 비운다 */
const FISH_TRAP_LANE = { x: [18.6, 24.4], z: [43.2, 47.3] };

export const isInFishTrapLane = (x: number, z: number) =>
  x >= FISH_TRAP_LANE.x[0] && x <= FISH_TRAP_LANE.x[1] && z >= FISH_TRAP_LANE.z[0] && z <= FISH_TRAP_LANE.z[1];

/** 빛 물고기 한 마리 — 몸통 + 꼬리지느러미. 미터, 머리가 +z */
export function buildFishGeometry() {
  const body = new THREE.SphereGeometry(1, 12, 8);
  body.scale(0.045, 0.032, 0.11);
  const tail = new THREE.ConeGeometry(0.055, 0.09, 4, 1);
  tail.rotateX(Math.PI / 2);
  tail.scale(1, 0.25, 1);
  tail.translate(0, 0, -0.14);
  const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
  const merged = mergeGeometries([flat(body), flat(tail)], false)!;
  body.dispose();
  tail.dispose();
  return merged;
}
