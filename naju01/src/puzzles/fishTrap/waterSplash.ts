/**
 * 줄이 당겨질 때 물이 튄다 — 왕관처럼 솟는 물(날씨 연출과 같은 물튀김 왕관 모형) + 흩어지는 물방울 + 불규칙하게 번지는 물결.
 * 날씨 연출의 물튀김은 비가 올 때만 그려져서 여기서 따로 둔다.
 */
import * as THREE from "three";
import { assetUrl } from "@/config/env";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { makeGlowPoints } from "../glowPoints";
import { M } from "../units";

const CROWNS = 4;
const DROPS = 90;
const RIPPLES = 4;
const CROWN_SECONDS = 0.45;
const RIPPLE_SECONDS = 1.3;
/** 물결이 번지는 넓이(반지름, 미터) */
const RIPPLE_RADIUS = 0.55;
const WATER = new THREE.Color("#E3ECF1");

const RIPPLE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
// 동심원을 그대로 두면 도형이다 — 각도마다 흔들어 찌그러뜨리고, 고리 셋이 차례로 번지며 옅어진다
const RIPPLE_FRAGMENT = /* glsl */ `
  uniform float uAge;
  uniform float uSeed;
  uniform vec3 uColor;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float angle = atan(p.y, p.x);
    float wobble = (noise(vec2(angle * 3.0 + uSeed, uAge * 4.0)) - 0.5) * 0.3;
    float front = pow(uAge, 0.7) * 0.95;
    float band = 0.0;
    for (int k = 0; k < 3; k++) {
      float f = front - float(k) * 0.16;
      if (f <= 0.0) continue;
      float width = 0.02 + f * 0.03;
      band += smoothstep(width, 0.0, abs(r + wobble * f - f)) * (1.0 - float(k) * 0.3);
    }
    // 끊기고 번진 고리 — 매끈한 원이면 도형이다
    band *= smoothstep(0.25, 0.75, noise(vec2(angle * 4.0, front * 3.0) + uSeed));
    band *= 0.6 + 0.4 * noise(p * 11.0 + uSeed);
    float fade = (1.0 - smoothstep(0.5, 1.0, uAge)) * (1.0 - smoothstep(0.75, 1.0, r));
    float a = band * fade * 0.38;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

interface Burst {
  /** 튄 때(초). 아직이면 음수 */
  start: number;
  /** 수면 자리(유닛) */
  at: THREE.Vector3;
  size: number;
}

export function createWaterSplash() {
  const group = new THREE.Group();

  // 왕관 — 모형이 읽히기 전에는 임시 원뿔
  const crownGeometry = new THREE.CylinderGeometry(1, 0.55, 1, 14, 1, true);
  crownGeometry.translate(0, 0.5, 0);
  const crown = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(
    crownGeometry,
    new THREE.MeshBasicMaterial({
      color: WATER,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    CROWNS,
  );
  crown.frustumCulled = false;
  crown.count = 0;
  new GLTFLoader().load(
    assetUrl("/vfx/물튀김_왕관.glb"),
    (gltf) => {
      let geometry: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((object) => {
        if (!geometry && (object as THREE.Mesh).isMesh) geometry = (object as THREE.Mesh).geometry.clone();
      });
      if (!geometry) return;
      const crownShape = geometry as THREE.BufferGeometry;
      crownShape.computeBoundingBox();
      const box = crownShape.boundingBox!;
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
      crownShape.translate(-(box.max.x + box.min.x) / 2, -box.min.y, -(box.max.z + box.min.z) / 2);
      crownShape.scale(2 / width, 2 / width, 2 / width);
      if (crownShape.getAttribute("color")) crownShape.deleteAttribute("color");
      crown.geometry = crownShape;
    },
    undefined,
    () => {},
  );

  const drops = makeGlowPoints(DROPS, { additive: false, softness: 1.4 });
  const dropPosition = Array.from({ length: DROPS }, () => new THREE.Vector3());
  const dropVelocity = Array.from({ length: DROPS }, () => new THREE.Vector3());
  const dropAlive = new Uint8Array(DROPS);
  let nextDrop = 0;

  const ripples = Array.from({ length: RIPPLES }, () => {
    const material = new THREE.ShaderMaterial({
      vertexShader: RIPPLE_VERTEX,
      fragmentShader: RIPPLE_FRAGMENT,
      uniforms: { uAge: { value: 1 }, uSeed: { value: Math.random() * 10 }, uColor: { value: WATER.clone() } },
      transparent: true,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(RIPPLE_RADIUS * M);
    mesh.visible = false;
    mesh.renderOrder = 2;
    return { mesh, material, start: -99 };
  });
  let nextRipple = 0;

  const bursts: Burst[] = Array.from({ length: CROWNS }, () => ({ start: -99, at: new THREE.Vector3(), size: 1 }));
  let nextBurst = 0;

  group.add(crown, drops.points, ...ripples.map((ripple) => ripple.mesh));

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let now = 0;

  return {
    group,
    /** 수면 자리(유닛)에서 한 번 튄다. strength 0~1 */
    trigger(at: THREE.Vector3, strength = 1) {
      const burst = bursts[nextBurst];
      nextBurst = (nextBurst + 1) % CROWNS;
      burst.start = now;
      burst.at.copy(at).setY(0.005 * M);
      burst.size = 0.6 + strength * 0.5;

      const ripple = ripples[nextRipple];
      nextRipple = (nextRipple + 1) % RIPPLES;
      ripple.start = now;
      ripple.mesh.position.copy(burst.at);
      ripple.material.uniforms.uSeed.value = Math.random() * 10;

      const count = Math.round(10 + strength * 10);
      for (let n = 0; n < count; n++) {
        const k = nextDrop;
        nextDrop = (nextDrop + 1) % DROPS;
        const angle = Math.random() * Math.PI * 2;
        const out = 0.25 + Math.random() * 0.6;
        dropPosition[k].copy(burst.at);
        dropVelocity[k].set(Math.cos(angle) * out, 1.1 + Math.random() * 1.1 * strength, Math.sin(angle) * out);
        dropVelocity[k].multiplyScalar(M);
        dropAlive[k] = 1;
      }
    },
    update(dt: number, time: number, pointScale: number) {
      now = time;
      let j = 0;
      for (const burst of bursts) {
        const u = (time - burst.start) / CROWN_SECONDS;
        if (u < 0 || u > 1) continue;
        const width = (0.1 + 0.14 * u) * burst.size;
        const height = 0.24 * burst.size * Math.sin(Math.PI * Math.min(1, u * 1.2));
        matrix.compose(burst.at, quaternion, scale.set(width * M, Math.max(height, 0.001) * M, width * M));
        crown.setMatrixAt(j++, matrix);
      }
      crown.count = j;
      crown.instanceMatrix.needsUpdate = true;
      (crown.material as THREE.MeshBasicMaterial).opacity = 0.5;

      for (let k = 0; k < DROPS; k++) {
        if (!dropAlive[k]) {
          drops.alpha.setX(k, 0);
          continue;
        }
        dropVelocity[k].y -= 9.8 * M * dt;
        dropPosition[k].addScaledVector(dropVelocity[k], dt);
        if (dropPosition[k].y < 0) {
          dropAlive[k] = 0;
          drops.alpha.setX(k, 0);
          continue;
        }
        const point = dropPosition[k];
        drops.position.setXYZ(k, point.x, point.y, point.z);
        drops.size.setX(k, 0.05 * M);
        drops.alpha.setX(k, 0.85);
        drops.color.setXYZ(k, WATER.r, WATER.g, WATER.b);
      }
      drops.commit();
      drops.material.uniforms.uPointScale.value = pointScale;

      for (const ripple of ripples) {
        const age = (time - ripple.start) / RIPPLE_SECONDS;
        ripple.mesh.visible = age >= 0 && age < 1;
        ripple.material.uniforms.uAge.value = age;
      }
    },
  };
}
