/**
 * 번개 전류 — 전선을 따라 치지직거리는 흰 번개. 쓰레기 퍼즐 전선 · 소화전 호스 · 전선관이 같이 쓴다.
 */
import * as THREE from "three";

const STRANDS = 3;
const POINT_SPACING = 0.05;

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aAlong;
  attribute float aSide;
  attribute float aStrand;
  uniform float uProg;
  uniform float uTime;
  uniform float uLen;
  uniform float uSurge;
  uniform float uTrail;
  varying float vAlong;
  varying float vSide;
  varying float vGate;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }
  // 꺾인 선 — 칸마다 값을 뽑아 곧게 잇는다. 치지직거리게 시간도 계단으로 끊는다
  float zigzag(float along, float tick, float seed) {
    float cell = floor(along / 0.16);
    float t = fract(along / 0.16);
    return mix(hash(vec3(cell, tick, seed)), hash(vec3(cell + 1.0, tick, seed)), t) - 0.5;
  }

  void main() {
    float along = aAlong * uLen;
    float tick = floor(uTime * 24.0 + aStrand * 7.0);
    float headDistance = abs(aAlong - uProg) * uLen;
    float atHead = (1.0 - smoothstep(0.0, 1.6, headDistance)) * step(uProg, 0.999);
    float nearEnd = smoothstep(0.55, 1.0, aAlong);
    // 앞머리가 지나간 자리도 같은 세기로 — 먼저 찬 통의 전선이 약해 보이지 않게
    float trail = uTrail * step(aAlong, uProg);
    float strength = max(max(atHead, uSurge * nearEnd), trail);

    // 전선을 따라 짧은 불꽃이 곳곳에서 튄다. 앞머리와 그림 쪽은 끊김 없이 이어진다
    float burst = hash(vec3(floor(along / 1.3), floor(uTime * 9.0), aStrand + 11.0));
    vGate = max(step(0.93, burst), strength);

    float reach = 0.025 + 0.07 * strength;
    vec3 across = normalize(cross(aTangent, vec3(0.31, 0.87, 0.38)));
    vec3 beside = cross(aTangent, across);
    vec3 bent = position
      + across * zigzag(along, tick, aStrand) * reach * 2.0
      + beside * zigzag(along, tick, aStrand + 5.0) * reach * 2.0;

    vec4 view = modelViewMatrix * vec4(bent, 1.0);
    vec3 viewTangent = normalize(normalMatrix * aTangent);
    vec2 face = normalize(cross(viewTangent, vec3(0.0, 0.0, 1.0)).xy + vec2(1e-4));
    view.xy += face * aSide * (0.008 + 0.009 * strength);
    gl_Position = projectionMatrix * view;
    vAlong = aAlong;
    vSide = aSide;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uProg;
  uniform float uFade;
  varying float vAlong;
  varying float vSide;
  varying float vGate;
  void main() {
    if (vAlong > uProg || vGate < 0.5) discard;
    float core = 1.0 - abs(vSide);
    float light = (0.5 + core * core * 2.6) * uFade;
    gl_FragColor = vec4(vec3(1.0, 0.98, 0.93) * light, clamp(light, 0.0, 1.0));
  }
`;

/** 번개 재질 — 자리는 전부 셰이더가 흔든다. 프레임마다 정점을 고쳐 쓰지 않고 시간만 넘긴다 */
export function createLightningMaterial({ throughWalls = false }: { throughWalls?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uProg: { value: 0 },
      uTime: { value: 0 },
      uLen: { value: 10 },
      uSurge: { value: 0 },
      uTrail: { value: 0 },
      uFade: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    // 관 속에 전류가 묻히지 않게 앞으로 비친다
    depthTest: !throughWalls,
    side: THREE.DoubleSide,
    // 더하기 혼합이라 순서가 무관하다 — 앞·뒤 두 번 나눠 그릴 이유가 없다
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
  });
}

/** 길을 따라 번개 세 가닥을 띠로 깐다 */
export function buildLightningGeometry(path: THREE.Curve<THREE.Vector3>, length: number) {
  const pointCount = Math.max(12, Math.ceil(length / POINT_SPACING));
  const strandVertices = (pointCount + 1) * 2;
  const vertexCount = strandVertices * STRANDS;
  const positions = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 3);
  const along = new Float32Array(vertexCount);
  const sides = new Float32Array(vertexCount);
  const strands = new Float32Array(vertexCount);
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  // 가닥은 모두 같은 길을 탄다 — 곡선은 첫 가닥에서만 재고 나머지는 복사한다
  for (let i = 0; i <= pointCount; i++) {
    const u = i / pointCount;
    path.getPointAt(u, point);
    path.getTangentAt(u, tangent);
    for (let side = 0; side < 2; side++) {
      const at = i * 2 + side;
      point.toArray(positions, at * 3);
      tangent.toArray(tangents, at * 3);
      along[at] = u;
      sides[at] = side * 2 - 1;
    }
  }
  for (let strand = 0; strand < STRANDS; strand++) {
    const first = strand * strandVertices;
    if (strand > 0) {
      positions.copyWithin(first * 3, 0, strandVertices * 3);
      tangents.copyWithin(first * 3, 0, strandVertices * 3);
      along.copyWithin(first, 0, strandVertices);
      sides.copyWithin(first, 0, strandVertices);
      strands.fill(strand, first, first + strandVertices);
    }
    for (let i = 0; i < pointCount; i++) {
      const a = first + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aTangent", new THREE.BufferAttribute(tangents, 3));
  geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("aSide", new THREE.BufferAttribute(sides, 1));
  geometry.setAttribute("aStrand", new THREE.BufferAttribute(strands, 1));
  geometry.setIndex(indices);
  return geometry;
}
