/**
 * 시공간 틈의 겉 — 일렁이는 테두리 · 새어 나오는 빛 · 안으로 도는 불티 · 가장자리에서 휘는 그림.
 * 틈 너머 그림은 쓰는 쪽이 GLSL 로 준다(진부촌 문은 그날 밤의 강, 벼랑 끝은 바위 아래 굿판).
 * uOpen 0~1 로 벌어지고 uTime(초)으로 일렁인다. uTwist 는 가장자리 그림이 감기는 정도 — 틈마다 매 프레임 정한다.
 */
import * as THREE from "three";

import { M } from "../units";

// 셰이더 문자열에는 ASCII 만 쓴다
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const PRELUDE = /* glsl */ `
  uniform float uTime;
  uniform float uOpen;
  uniform float uTwist;
  uniform float uMargin;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
const FRAME = /* glsl */ `
  void main() {
    #include <logdepthbuf_fragment>
    vec2 q = (vUv - 0.5) * 2.0 * uMargin;
    float angle = atan(q.y, q.x);
    float d = length(q * vec2(1.0, 0.92));
    float rim = uOpen * (0.96 + 0.05 * sin(angle * 7.0 + uTime * 3.0) + 0.06 * (noise(vec2(angle * 3.0, uTime)) - 0.5));
    float inside = smoothstep(rim, rim - 0.08, d);
    float ring = exp(-abs(d - rim) * 26.0) * step(0.02, uOpen);
    // rim halo: light leaking out of the tear, so it reads as a gap of light rather than a black hole
    float halo = exp(-max(d - rim, 0.0) * 5.5) * step(rim, d) * 0.45 * uOpen;
    // sparks circling inside, drifting inward from the rim
    float spark = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float sa = angle * 6.0 + uTime * (0.8 + fk * 0.35) + fk * 2.1;
      float sr = rim * (0.55 + 0.35 * fract(uTime * 0.13 + fk * 0.33));
      spark += exp(-abs(d - sr) * 40.0) * pow(max(0.0, sin(sa)), 24.0);
    }
    // swirl the vision near the rim
    float swirl = pow(clamp(d / max(rim, 0.001), 0.0, 1.0), 3.0) * 0.6;
    float s = sin(swirl * uTwist), c = cos(swirl * uTwist);
    vec2 p = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * 0.5 + 0.5;
    vec3 col = riftVision(p);
    // rim of the tear: violet into warm
    vec3 edge = mix(vec3(0.62, 0.48, 1.0), vec3(1.0, 0.75, 0.45), 0.5 + 0.5 * sin(angle * 3.0 + uTime));
    vec3 outCol = col * inside + edge * ring * 1.8 + edge * halo + vec3(1.0, 0.92, 0.8) * spark * inside * 0.9;
    float a = max(max(inside * 0.97, ring), halo + spark * inside);
    if (a < 0.01) discard;
    gl_FragColor = vec4(outCol, a);
  }
`;

/**
 * 틈 재질. vision 은 `vec3 riftVision(vec2 p)` 를 정의하는 GLSL — p 는 틈 안 그림 좌표(0~1, 위가 +y),
 * uTime · hash · noise 를 쓸 수 있다.
 * margin 은 판이 틈보다 큰 배수 — 1 이면 새어 나오는 빛이 판 가장자리에서 잘린다. 판을 그만큼 키워서 쓴다.
 */
export function makeRiftMaterial(vision: string, margin = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: PRELUDE + vision + FRAME,
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uTwist: { value: 1 }, uMargin: { value: margin } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** 틈 너머를 보는 자리(유닛) — 틈 한가운데 서면 틈 자체는 발밑이라, 지금 보는 쪽으로 틈을 지나 더 멀리 눈높이에 둔다 */
export function pointBeyondRift(camera: THREE.Camera, riftCenter: THREE.Vector3) {
  const beyond = new THREE.Vector3().subVectors(riftCenter, camera.position);
  beyond.y = 0;
  if (beyond.length() < 0.3 * M) camera.getWorldDirection(beyond).setY(0);
  beyond
    .normalize()
    .multiplyScalar(4 * M)
    .add(camera.position);
  beyond.y = camera.position.y;
  return beyond;
}
