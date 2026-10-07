import * as THREE from "three";

/** 통에서 액자까지 전류가 가는 시간(초) */
export const FLOW_SECONDS = 2.4;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uProg;   // 앞머리 자리 0~1
  uniform float uTime;
  uniform float uLen;    // 선 길이(유닛) — 빛 덩이 간격을 길이와 무관하게 맞춘다
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float u = vUv.x;
    if (u > uProg) discard;
    float d = u * uLen;
    float pulse = pow(fract(d / 0.9 - uTime * 2.2), 10.0);
    float ripple = 0.5 + 0.5 * sin(d * 7.0 - uTime * 11.0);
    float head = smoothstep(uProg - 0.6 / uLen, uProg, u);
    float a = 0.18 + 0.2 * ripple + pulse * 1.6 + head * 2.4;
    gl_FragColor = vec4(uColor * a, clamp(a, 0.0, 1.0));
  }
`;

/**
 * 전선 위에 씌우는 빛의 관 — 앞머리까지만 보이고 그 안에서 빛 덩이가 흘러간다.
 * 빛 덩이를 메시로 굴리면 매 프레임 자리를 다 옮겨야 한다. 관 하나에 시간만 넘기면 GPU 가 흘린다.
 */
export function createCurrentMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uProg: { value: 0 },
      uTime: { value: 0 },
      uLen: { value: 10 },
      uColor: { value: new THREE.Color("#8fe6ff") },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
