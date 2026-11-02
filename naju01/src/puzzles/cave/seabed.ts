/**
 * 강 밑 바닥 꾸밈 — 모래 바닥(물결 자국·물빛 일렁임), 갈라진 물벽, 머리 위 수면, 조개껍데기, 빛줄기, 미르 모형(바위·자갈·풀) 깔기.
 * 모양과 재질만 만든다. 자리 판정은 caveState, 연출은 CaveWorld 가 한다. 길이는 미터.
 */
import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

import { M } from "../fishTrap/shared";

/** 셰이더 공통 — 로그 깊이 버퍼 · 안개 */
const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
`;

const WORLD_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }
`;

// 모래 — 결(물결 자국)·알갱이·3단 명암 위에 물빛 일렁임(caustic)을 얹는다. 일렁임 세기는 uCaustic(물속 0~1)
const SAND_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uM;
  uniform float uCaustic;
  uniform vec3 uColor;
  uniform vec3 uDark;
  uniform vec3 uLightDir;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = vWorld / uM;
    float ripple = sin(p.x * 7.0 + noise(p.xz * 0.6) * 5.0 + p.z * 0.8);
    float grain = noise(p.xz * 9.0) * 0.5 + noise(p.xz * 23.0) * 0.5;
    float light = clamp(dot(normalize(vNormal), normalize(uLightDir)), 0.0, 1.0);
    float toon = light > 0.55 ? 1.0 : light > 0.25 ? 0.72 : 0.5;
    vec3 color = mix(uDark, uColor, toon);
    color *= 0.9 + 0.1 * ripple + (grain - 0.5) * 0.14;
    // 두 노이즈가 같아지는 자리에 실 같은 빛줄이 생긴다
    float c1 = noise(p.xz * 1.2 + vec2(uTime * 0.11, -uTime * 0.07));
    float c2 = noise(p.xz * 1.7 - vec2(uTime * 0.09, uTime * 0.13) + 3.1);
    float caustic = pow(max(0.0, 1.0 - abs(c1 - c2) * 4.0), 3.0);
    // 흰 빛줄 한 겹 더 — 다른 빠르기·방향으로 돈다. 하늘빛은 옅게, 흰빛이 주
    float w1 = noise(p.xz * 1.5 + vec2(-uTime * 0.08, uTime * 0.1) + 7.7);
    float w2 = noise(p.xz * 1.1 + vec2(uTime * 0.12, uTime * 0.05) + 1.3);
    float white = pow(max(0.0, 1.0 - abs(w1 - w2) * 4.0), 3.0);
    color += vec3(0.62, 0.78, 0.8) * caustic * 0.45 * uCaustic;
    color += vec3(0.95, 0.95, 0.93) * white * 0.85 * uCaustic;
    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
  }
`;

// 물벽 — 갈라져 선 강물. 아래로 흐르는 결, 바닥의 흰 거품띠, 위로 갈수록 하늘빛으로 옅어진다
const CURTAIN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uM;
  uniform float uBottom;
  uniform float uTop;
  uniform vec3 uDeep;
  uniform vec3 uLight;
  uniform vec3 uSky;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = vWorld / uM;
    float h = clamp((p.y - uBottom) / (uTop - uBottom), 0.0, 1.0);
    float streak = noise(vec2(p.z * 1.6 + p.x * 0.3, p.y * 0.35 + uTime * 1.4));
    streak = smoothstep(0.42, 0.82, streak);
    float fine = noise(vec2(p.z * 5.0 + p.x, p.y * 1.2 + uTime * 3.0));
    float foam = smoothstep(1.1, 0.0, p.y - uBottom) * (0.55 + 0.45 * noise(vec2(p.z * 3.0 - uTime * 0.8, p.x * 2.0 + uTime * 1.5)));
    float ghost = smoothstep(0.66, 0.92, noise(vec2(p.z * 0.18 + uTime * 0.05, p.y * 0.2 + p.x * 0.05)));
    vec3 color = mix(uDeep, uLight, streak * 0.55 + fine * 0.15 + ghost * 0.4);
    color = mix(color, uSky, smoothstep(0.3, 1.0, h) * 0.65);
    color = mix(color, vec3(0.93, 0.97, 0.98), foam);
    float alpha = mix(0.84, 0.46, h) + foam * 0.16 + streak * 0.06;
    gl_FragColor = vec4(color, alpha);
    #include <fog_fragment>
  }
`;

// 수면을 밑에서 본 것 — 밝은 물결무늬가 느리게 흐른다
const CEILING_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uM;
  uniform vec3 uDeep;
  uniform vec3 uLight;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  ${NOISE_GLSL}
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = vWorld / uM;
    float n1 = noise(p.xz * 0.9 + vec2(uTime * 0.15, uTime * 0.05));
    float n2 = noise(p.xz * 1.7 - vec2(uTime * 0.1, uTime * 0.12) + 7.0);
    float web = pow(max(0.0, 1.0 - abs(n1 - n2) * 3.5), 2.0);
    vec3 color = mix(uDeep, uLight, 0.25 + web * 0.75);
    gl_FragColor = vec4(color, 0.8);
    #include <fog_fragment>
  }
`;

const shaderMaterial = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, options: Partial<THREE.ShaderMaterialParameters> = {}) =>
  new THREE.ShaderMaterial({
    vertexShader: WORLD_VERTEX,
    fragmentShader,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    fog: true,
    ...options,
  });

export const makeSandMaterial = () =>
  shaderMaterial(SAND_FRAGMENT, {
    uTime: { value: 0 },
    uM: { value: M },
    uCaustic: { value: 0 },
    uColor: { value: new THREE.Color("#8B8A72") },
    uDark: { value: new THREE.Color("#55594E") },
    uLightDir: { value: new THREE.Vector3(0.3, 1, 0.2) },
  });

export const makeCurtainMaterial = (bottom: number, top: number) =>
  shaderMaterial(
    CURTAIN_FRAGMENT,
    {
      uTime: { value: 0 },
      uM: { value: M },
      uBottom: { value: bottom },
      uTop: { value: top },
      uDeep: { value: new THREE.Color("#1A5263") },
      uLight: { value: new THREE.Color("#8FD8DF") },
      uSky: { value: new THREE.Color("#BFD9DE") },
    },
    { transparent: true, depthWrite: false, side: THREE.DoubleSide },
  );

export const makeCeilingMaterial = () =>
  shaderMaterial(
    CEILING_FRAGMENT,
    {
      uTime: { value: 0 },
      uM: { value: M },
      uDeep: { value: new THREE.Color("#163F4D") },
      // 수면 빛무늬 — 하늘빛보다 흰빛 위주
      uLight: { value: new THREE.Color("#DCE8E6") },
    },
    { transparent: true, depthWrite: false, side: THREE.DoubleSide },
  );

/** 풀 모형을 물풀로 — 색을 청록으로 물들이고, 꼭대기일수록 크게 흔들린다 */
export function makeSeaweedMaterial(time: THREE.IUniform<number>) {
  const material = new THREE.MeshToonMaterial({ color: "#5F8F80", vertexColors: true, gradientMap: TOON_GRADIENT, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          float h = clamp(position.y, 0.0, 1.0);
          #ifdef USE_INSTANCING
            vec4 base = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          #else
            vec4 base = vec4(0.0);
          #endif
          float phase = base.x * 0.7 + base.z * 0.9;
          transformed.x += sin(uTime * 1.1 + phase) * h * h * 0.14;
          transformed.z += cos(uTime * 0.8 + phase * 1.3) * h * h * 0.09;
        }`,
      );
  };
  return material;
}

interface GroundSpec {
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
  segmentsX: number;
  segmentsZ: number;
  heightAt: (x: number, z: number) => number;
}

/** 바닥 한 장(미터) — 꼭짓점 높이를 자리마다 묻는다 */
export function buildGround({ width, depth, centerX, centerZ, segmentsX, segmentsZ, heightAt }: GroundSpec) {
  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ).rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + centerX;
    const z = position.getZ(i) + centerZ;
    position.setXYZ(i, x, heightAt(x, z), z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 조개껍데기 한 장 — 경첩이 원점, 바깥으로 1 까지 부채꼴로 퍼지는 볼록한 판(−z 쪽). 꼭짓점 색은 명암 배율(재질 색이 곱해진다)
 */
export function buildShellGeometry(rings = 12, rays = 22) {
  // 골(부챗살) 아홉 줄이 또렷해야 조개로 읽힌다 — 살이 적으면 골이 뭉개져 늘린다
  const ringCount = Math.max(rings, 14);
  const rayCount = Math.max(rays, 40);
  const SPREAD = 1.95;
  const RIBS = 9;
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i <= ringCount; i++) {
    const t = i / ringCount;
    for (let j = 0; j <= rayCount; j++) {
      const phi = (j / rayCount - 0.5) * 2 * SPREAD;
      const rib = Math.cos(phi * RIBS);
      // 가장자리는 골을 따라 물결친다(부채꼴 조개 입술)
      const lip = 1 + 0.04 * rib * THREE.MathUtils.smoothstep(t, 0.8, 1);
      const edge = (0.62 + 0.38 * Math.cos(phi * 0.62)) * lip;
      const r = t * edge;
      const x = Math.sin(phi) * r * 1.12;
      const z = -Math.cos(phi) * r;
      const ribHeight = 0.026 * Math.pow(0.5 + 0.5 * rib, 2) * THREE.MathUtils.smoothstep(t, 0.12, 0.55);
      const dome = 0.3 * Math.pow(1 - t * t, 0.55) + ribHeight;
      positions.push(x, dome, z);
      // 골마루는 밝게, 골짜기는 어둡게. 가는 성장선 · 뒤꼭지(부리) 쪽은 짙게
      const growth = Math.pow(0.5 + 0.5 * Math.sin(t * 34), 4);
      const umbo = 1 - THREE.MathUtils.smoothstep(t, 0.05, 0.3);
      const shade = 0.9 + 0.14 * rib * THREE.MathUtils.smoothstep(t, 0.15, 0.5) - growth * 0.1 - umbo * 0.22 + 0.06 * THREE.MathUtils.smoothstep(t, 0.75, 1);
      colors.push(shade, shade * 0.98, shade * 0.94);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < ringCount; i++) {
    for (let j = 0; j < rayCount; j++) {
      const a = i * (rayCount + 1) + j;
      const b = a + rayCount + 1;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** 빛줄기 — 가운데가 밝고 위아래·양옆으로 사라지는 띠 */
export function makeShaftTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const u = Math.abs(x / 63 - 0.5) * 2;
      const v = y / 127;
      const a = Math.pow(1 - u, 1.6) * Math.pow(Math.sin(v * Math.PI), 0.7);
      const k = (y * 64 + x) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = 255;
      image.data[k + 3] = Math.round(a * 255);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 표본을 「밑동 원점 · 가장 긴 변 1」로 맞춘 복제본 — 캐시된 표본은 건드리지 않는다 */
export function normalizePrototype(prototype: THREE.BufferGeometry) {
  const geometry = prototype.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(1 / longest, 1 / longest, 1 / longest);
  geometry.computeBoundingBox();
  return geometry;
}

export interface Placement {
  x: number;
  y: number;
  z: number;
  /** 가장 긴 변(미터) */
  size: number;
  yaw: number;
  /** 바닥에 묻는 비율(0~1) */
  sink?: number;
  /** 표본 번호 */
  variant: number;
  /** 세로 눌림(1 = 그대로) */
  squash?: number;
}

/** 표본마다 InstancedMesh 하나 — 자리는 미터, 그룹에 scale={M} 을 걸어 쓴다 */
export function buildInstances(prototypes: THREE.BufferGeometry[], placements: Placement[], material: THREE.Material) {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  return prototypes.map((geometry, variant) => {
    const mine = placements.filter((p) => p.variant % prototypes.length === variant);
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, mine.length));
    mesh.count = mine.length;
    geometry.computeBoundingBox();
    const height = geometry.boundingBox!.max.y;
    mine.forEach((p, i) => {
      const squash = p.squash ?? 1;
      const sink = (p.sink ?? 0) * height * p.size * squash;
      quaternion.setFromAxisAngle(up, p.yaw);
      matrix.compose(new THREE.Vector3(p.x, p.y - sink, p.z), quaternion, new THREE.Vector3(p.size, p.size * squash, p.size));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
}
