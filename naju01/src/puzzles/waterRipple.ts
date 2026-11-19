/**
 * 물낯에 번지는 물결 — 무언가 잠기거나 솟은 자리에서 잔물결 여러 겹이 고르지 않게 퍼지며 스러진다.
 * 고리를 긋지 않는다: 너울 두어 겹의 마루에만, 그것도 끊긴 호로 빛이 얹히고, 잠긴 자리는 잠깐 물이 뒤집혀 거품이 인다.
 * 판은 +y 를 보는 지름 2 의 원반이다 — 놓는 쪽이 물낯 크기로 키우고 uAge(0 → 1)를 올린다.
 */
import * as THREE from "three";

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;

const FRAGMENT = /* glsl */ `
  uniform float uAge;
  uniform float uSeed;
  uniform vec3 uColor;
  varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = (vUv - 0.5) * 2.0;
    float angle = atan(p.y, p.x);
    // 물머리는 원이 아니다 — 어느 쪽은 앞서고 어느 쪽은 처지며, 번질수록 더 어긋난다
    float lumpy = noise(vec2(cos(angle), sin(angle)) * 1.7 + uSeed) - 0.5;
    float r = length(p) * (1.0 + (0.3 + 0.5 * uAge) * lumpy);
    float front = uAge * 1.05;
    // 너울 두어 겹이 물머리를 뒤따른다 — 마루에만, 그것도 끊긴 호로 빛이 얹힌다
    float behind = front - r;
    float swell = sin(behind * 15.0) * exp(-behind * 4.0) * step(0.0, behind);
    float crest = smoothstep(0.25, 0.95, swell) * smoothstep(0.0, 0.1, behind);
    float arcs = smoothstep(0.3, 0.75, noise(vec2(angle * 2.2 + uSeed * 2.0, r * 4.0 - uAge * 2.0)));
    // 잠긴 자리의 뒤집힌 물 — 금세 흩어진다
    float foam = (1.0 - smoothstep(0.0, 0.34 + 0.3 * uAge, r)) * pow(1.0 - uAge, 2.5);
    foam *= smoothstep(0.35, 0.8, noise(p * 7.0 + uSeed * 3.0 + uAge * 2.0));
    float fade = (1.0 - uAge) * (1.0 - smoothstep(0.75, 1.0, length(p)));
    float alpha = (crest * arcs * 0.4 + foam * 0.55) * fade;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }`;

/** 물결 판 하나. 처음에는 안 보인다 — visible 을 켜고 uAge 를 0 에서 1 로 올린다 */
export function makeWaterRipple(color: THREE.ColorRepresentation = "#D6E4FA") {
  const material = new THREE.ShaderMaterial({
    uniforms: { uAge: { value: 1 }, uSeed: { value: Math.random() * 40 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material);
  mesh.visible = false;
  return { mesh, material };
}

export type WaterRipple = ReturnType<typeof makeWaterRipple>;

/** age(0~1)의 모습으로 놓는다 — 0 보다 작거나 1 을 넘으면 감춘다 */
export function setRippleAge(ripple: WaterRipple, age: number) {
  ripple.mesh.visible = age > 0 && age < 1;
  ripple.material.uniforms.uAge.value = THREE.MathUtils.clamp(age, 0, 1);
}
