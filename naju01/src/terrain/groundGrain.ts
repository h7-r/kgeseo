// 땅·비탈·길·절벽에 삼면(triplanar) 결을 얹는다.
// 바닥 지오메트리는 합치기 위해 uv 를 전부 떼어 냈다 — 삼면 투영은 월드 좌표만 쓰므로 uv 가 필요 없다.
// GLSL 은 한글 식별자를 못 쓴다(번들은 통과하고 GPU 에서 깨진다). 셰이더 안 이름과 attribute 이름은 ASCII 로.
// 셰이더 안 좌표 단위는 미터다.
import * as THREE from "three";
import { UNITS_PER_METER } from "../plan/sitePlan";

export interface GrainHandle {
  uniforms: {
    grainAmp: THREE.IUniform<number>;
    grainRock: THREE.IUniform<number>;
  };
}

export interface GrainOptions {
  /** 길 전용 결. 지오메트리에 `pathGrain`(진행방향 x, z, 가로자리 u) 속성이 있어야 한다. */
  path?: boolean;
}

const NOISE_GLSL = /* glsl */ `
  // cheap 3D value noise — no texture lookup, no uv
  float grainHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float grainNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(grainHash(i + vec3(0,0,0)), grainHash(i + vec3(1,0,0)), f.x),
          mix(grainHash(i + vec3(0,1,0)), grainHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(grainHash(i + vec3(0,0,1)), grainHash(i + vec3(1,0,1)), f.x),
          mix(grainHash(i + vec3(0,1,1)), grainHash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  // 3 octaves is enough — more costs pixels and adds nothing at this scale
  float grainFbm(vec3 p) {
    return grainNoise(p) * 0.55
         + grainNoise(p * 2.17 + 13.7) * 0.29
         + grainNoise(p * 4.63 + 41.3) * 0.16;
  }
`;

// 길은 진행 방향으로 늘어난 결 + 바퀴 자국. 흙바닥과 같은 둥근 얼룩을 주면 그냥 흙판이 된다.
const PATH_BLOT_GLSL = `
           vec2 dir = normalize(vPathGrain.xy + vec2(1e-5));
           vec2 side = vec2(-dir.y, dir.x);
           float along = dot(p.xz, dir);
           float across = dot(p.xz, side);
           blot = (grainFbm(vec3(along * 0.16, p.y * 0.4, across * 1.05)) - 0.5) * 0.34
                + (grainFbm(vec3(along * 0.55, p.y * 0.4, across * 3.1) + 9.0) - 0.5) * 0.30;
           // 걷는 폭의 |u| ≈ 0.5 에 다져진 띠 둘, 가운데(u=0)는 발이 모여 한 번 더 밝다
           float u = vPathGrain.z;
           float rut = exp(-pow((abs(u) - 0.5) / 0.17, 2.0));
           float mid = exp(-pow(u / 0.22, 2.0));
           // 자국을 따라 끊기게 — 연속한 띠면 레일처럼 보인다
           float broken = grainFbm(vec3(along * 0.5, 0.0, 0.0) + 31.0) * 0.6 + 0.55;
           blot -= rut * 0.18 * broken;
           blot += mid * 0.10;`;

// 큰 무늬를 키우면 바닥에 검은 아메바가 앉는다. 흙바닥 변화는 발밑의 잔 결이 대부분이다.
const SOIL_BLOT_GLSL = `
           float wide = grainFbm(p * 0.17);
           float mid  = grainFbm(p * 0.62 + 7.3);
           float fine = grainFbm(p * 2.9 + 21.1);
           blot = (wide - 0.5) * 0.16 + (mid - 0.5) * 0.24 + (fine - 0.5) * 0.34;
           // 바탕색으로 재료를 가른다: 잿빛 = 자갈, 초록 = 풀, 나머지 = 흙
           float mx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
           float mn = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
           float sat = mx > 0.001 ? (mx - mn) / mx : 0.0;
           float gravel = smoothstep(0.22, 0.08, sat);
           float grass = smoothstep(0.02, 0.14, diffuseColor.g - diffuseColor.r);
           // 무게가 0 인 항은 건너뛴다 — fbm 하나가 해시 24 번이라 화면 절반인 땅에서 크다.
           // 갈래가 꼭짓점 색에서 오므로 이웃 픽셀이 같은 갈래를 탄다.
           if (gravel > 0.004)
             blot += (grainFbm(p * 4.2) - 0.5) * 0.34 * gravel;
           if (grass > 0.004)
             blot += (grainFbm(p * 1.9 + 3.3) - 0.5) * 0.26 * grass;`;

const handles: GrainHandle[] = [];
let currentStrength = 1;
let currentRock = 1;

/** 걸린 모든 바닥 재질의 결 세기를 한 번에 바꾼다. 0 이면 결이 없던 때와 픽셀까지 같다. */
export function setGrainStrength(strength = 1, rock = 1) {
  currentStrength = strength;
  currentRock = rock;
  for (const handle of handles) {
    handle.uniforms.grainAmp.value = strength;
    handle.uniforms.grainRock.value = rock;
  }
}

/** 재질 하나에 한 번만 건다. 두 번 걸면 셰이더가 두 겹으로 붙어 터진다. */
function attachGrain(material: THREE.Material | null, { path = false }: GrainOptions = {}): GrainHandle | null {
  if (!material) return null;
  if (material.userData.groundGrainAttached) return (material.userData.groundGrainHandle as GrainHandle) ?? null;

  const uniforms = {
    grainAmp: { value: 1 },
    grainRock: { value: 1 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    // worldPosition 은 조건부로만 생겨서 직접 만든다
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vGrainPos;
         ${path ? "attribute vec3 pathGrain;\n         varying vec3 vPathGrain;" : ""}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz / ${UNITS_PER_METER.toFixed(6)};
         ${path ? "vPathGrain = pathGrain;" : ""}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vGrainPos;
         ${path ? "varying vec3 vPathGrain;" : ""}
         uniform float grainAmp;
         uniform float grainRock;
         ${NOISE_GLSL}`,
      )
      // 꼭짓점 색이 diffuseColor 에 실린 직후에 밝기만 흔든다
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         {
           vec3 p = vGrainPos;
           float blot;
           ${path ? PATH_BLOT_GLSL : SOIL_BLOT_GLSL}
           // 가파를수록 바위 — 평평한 데(ny=1)는 0, 선 면(ny=0)은 1
           float steep = clamp(1.0 - abs(normalize(vNormal).y), 0.0, 1.0);
           steep = smoothstep(0.25, 0.75, steep) * grainRock;
           // 바위 면은 물이 흘러내린 세로 결
           if (steep > 0.004) {
             float streak = grainFbm(vec3(p.x * 3.4, p.y * 0.55, p.z * 3.4) + 5.0);
             blot += (streak - 0.5) * 0.30 * steep;
           }
           // 반드시 조인다 — 항이 한쪽으로 몰리면 밝기가 0.19 배까지 떨어져 새까맣게 탄다
           blot = clamp(blot, -0.42, 0.42);
           // 색상은 꼭짓점 색 그대로, 명암만 준다
           diffuseColor.rgb *= 1.0 + blot * 0.30 * grainAmp;
           diffuseColor.rgb *= 1.0 - steep * 0.09 * grainAmp;
         }`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         {
           vec3 p = vGrainPos * 3.1;
           float e = 0.35;
           float n0 = grainNoise(p);
           float nx = grainNoise(p + vec3(e, 0.0, 0.0));
           float nz = grainNoise(p + vec3(0.0, 0.0, e));
           // 세게 주면 평평한 바닥이 우둘투둘한 금속처럼 번들거린다
           vec2 g = vec2(nx - n0, nz - n0) * 1.1 * grainAmp;
           normal = normalize(normal + vec3(-g.x, 0.0, -g.y));
         }`,
      );
  };
  // 길과 땅은 셰이더가 다르다. 키가 같으면 three 가 프로그램을 재활용해 서로의 셰이더를 물려받는다.
  material.customProgramCacheKey = () => (path ? "groundGrain.path" : "groundGrain");
  material.needsUpdate = true;

  const handle: GrainHandle = { uniforms };
  handles.push(handle);
  handle.uniforms.grainAmp.value = currentStrength;
  handle.uniforms.grainRock.value = currentRock;
  material.userData.groundGrainAttached = true;
  material.userData.groundGrainHandle = handle;
  return handle;
}

/**
 * 재질 ref 에 그대로 물리는 콜백. 바닥셰이딩을 바꾸면 재질이 새로 생기고 ref 가 다시 불려 새 재질에도 걸린다.
 * `box` 를 주면 손잡이를 담아 둔다.
 */
export function groundGrainRef(box: { current: GrainHandle | null } | null = null, options: GrainOptions = {}) {
  return (material: THREE.Material | null) => {
    if (!material) return;
    const handle = attachGrain(material, options);
    if (box) box.current = handle;
  };
}
