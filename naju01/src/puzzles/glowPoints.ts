/** 점마다 크기(미터) · 투명도 · 색을 따로 주는 부드러운 빛점 — 불티 · 연기 · 거품 · 물튀김이 같이 쓴다 */
import * as THREE from "three";

// 로그 깊이 버퍼를 쓰는 씬이라 직접 쓴 셰이더도 그 조각을 넣어야 깊이가 맞는다
const VERTEX = /* glsl */ `
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
const FRAGMENT = /* glsl */ `
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
 * 불 · 불씨는 더해 칠하고(additive), 연기는 덮어 칠한다(normal) —
 * 연기를 더해 칠하면 밝은 하늘에서 하얗게 날아가 글자가 안 읽힌다.
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
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
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
