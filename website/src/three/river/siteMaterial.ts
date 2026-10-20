import * as THREE from "three";

import { ATMOSPHERE, NOISE, STORY } from "./glsl";
import { PALETTE, type SharedUniforms } from "./world";

// 강가 자리의 재질. 솔기 하나가 건물을 위아래로 훑으며 「지금」과 「옛날」을 가른다 —
// 솔기는 토막마다 높이가 조금씩 달라 계단처럼 어긋나고, 그 자리 꼭짓점이 가로로 미끄러지며, 솔기 자체는 청록으로 빛난다.
// 명암은 처음엔 부드러운 달빛이다가 게임 모습으로 굳으면(uGame) 세 단 계단 + 남색 달빛에 물든 툰 색이 된다.
//
// 자리 서른 남짓을 겹(지금·옛날·외곽선)마다 지오메트리 하나로 묶어 그린다 — 자리마다 메시를 따로 두면
// 반사 패스까지 그리기 호출이 백 개를 넘어 프레임이 반으로 떨어졌다. 꼭짓점마다 자리 번호(aSite)를 달고,
// 자리별 값(솔기 진행·높이 범위·방식)은 uniform 배열로 넘긴다.

/** 한꺼번에 비추는 빛(가로등·횃불) 수. 셰이더 반복 횟수를 고정해야 해서 박는다. */
export const MAX_SITE_LIGHTS = 8;

/** 자리 하나가 맡는 방식. */
export const SITE_MODE = {
  /** 지금·옛날 짝이 솔기로 갈린다. */
  seam: 0,
  /** 짝 없이 가로 토막으로 사라지거나(지금) 나타난다(옛날). */
  slices: 1,
  /** 늘 그대로(둑 바닥). */
  still: 2,
} as const;

/** 솔기가 위에서 내려오는 자리는 높이 범위 아래 끝에 이만큼 더해 표시한다(높이는 이보다 훨씬 작다). */
export const SEAM_DOWN_FLAG = 1000;

/** 겹 하나의 역할. */
export type SiteLayer = "modern" | "past" | "outline";

// 솔기 높이 — 정점·조각 셰이더가 같은 식을 쓴다. shape = (아래 끝[+SEAM_DOWN_FLAG], 위 끝, 방식).
const SEAM = /* glsl */ `
  float seamDown(vec3 shape) {
    return step(${SEAM_DOWN_FLAG / 2}.0, shape.x);
  }

  float seamHeight(vec3 shape, float morph) {
    float down = seamDown(shape);
    float bottom = shape.x - down * ${SEAM_DOWN_FLAG}.0;
    float travel = down > 0.5 ? 1.0 - morph : morph;
    return mix(bottom - 0.6, shape.y + 0.6, travel);
  }
`;

const vertexShader = (siteCount: number) => /* glsl */ `
  ${NOISE}
  ${STORY}
  ${SEAM}
  uniform float uTime;
  uniform float uMorphs[${siteCount}];
  uniform vec3 uShapes[${siteCount}];
  attribute float aGlow;
  attribute float aSite;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vGlow;
  varying float vMorph;
  varying vec3 vShape;
  varying float vSite;

  void main() {
    int site = int(aSite + 0.5);
    vMorph = uMorphs[site];
    vShape = uShapes[site];
    vSite = aSite;
    vec4 world = modelMatrix * vec4(position, 1.0);
    // 솔기 둘레의 가로 띠가 옆으로 어긋난다. 바뀌는 동안 세게, 멈춘 뒤엔 왜곡이 남은 만큼만.
    if (vShape.z < 0.5) {
      float near = exp(-pow((world.y - seamHeight(vShape, vMorph)) / 1.1, 2.0));
      float moving = step(0.001, vMorph) * (0.25 + uDistort);
      world.x += (hash12(vec2(floor(world.y / 0.45), floor(uTime * 9.0))) - 0.5) * 0.9 * near * moving;
    }
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vColor = color;
    vGlow = aGlow;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  ${NOISE}
  ${ATMOSPHERE}
  ${STORY}
  ${SEAM}
  uniform float uLayer;
  uniform float uOutline;
  uniform vec3 uInk;
  uniform vec3 uSeamColor;
  uniform vec3 uKeyDir;
  uniform vec3 uLights[${MAX_SITE_LIGHTS}];
  uniform vec3 uLightColors[${MAX_SITE_LIGHTS}];
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vGlow;
  varying float vMorph;
  varying vec3 vShape;
  varying float vSite;

  void main() {
    float glowSeam = 0.0;
    if (vShape.z < 0.5) {
      // 2m 토막마다 높이가 조금씩 달라 계단처럼 어긋난다(왜곡이 셀 때만 토막이 들썩인다).
      float tick = floor(uTime * 3.0) * step(0.001, uDistort);
      float seam = seamHeight(vShape, vMorph)
        + (hash12(vec2(floor((vWorld.x + vWorld.z) / 2.0), tick)) - 0.5) * (0.2 + uDistort * 0.6);
      float pastSide = seamDown(vShape) > 0.5 ? step(seam, vWorld.y) : step(vWorld.y, seam);
      if ((uLayer > 0.5 ? pastSide : 1.0 - pastSide) < 0.5) discard;
      glowSeam = exp(-pow((vWorld.y - seam) / 0.09, 2.0)) * step(0.001, vMorph) * step(vMorph, 0.999);
    } else if (vShape.z < 1.5) {
      // 0.6m 가로 토막마다 사라지는 순서가 다르다.
      float order = hash12(vec2(floor(vWorld.y / 0.6), vSite * 7.13));
      float shown = uLayer > 0.5 ? step(order, vMorph) : step(vMorph, order);
      if (shown < 0.5) discard;
    }

    if (uOutline > 0.5) {
      gl_FragColor = vec4(applyFog(uInk, vWorld), 1.0);
      return;
    }

    vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
    vec3 base = vColor;
    // 게임 모습: 채도를 덜고 남색 달빛으로 물들인다 — 따뜻한 짚·나무만 은근히 남는다.
    float grey = dot(base, vec3(0.3, 0.59, 0.11));
    base = mix(base, mix(base, grey * vec3(0.78, 0.88, 1.15), 0.55), uGame * 0.7);
    // 옛 모습(게임 모형)은 처음부터 게임처럼 계단 명암 — 부드럽게 비친 지금 건물과 한눈에 갈린다.
    float toon = max(uGame, uLayer);

    float key = dot(n, uKeyDir) * 0.5 + 0.5;
    float soft = 0.25 + 0.65 * key;
    float cel = 0.34 + 0.33 * smoothstep(0.44, 0.47, key) + 0.33 * smoothstep(0.72, 0.75, key);
    vec3 lit = base * mix(soft, cel, toon) * vec3(0.66, 0.74, 0.95);

    // 가로등·횃불 — 가까운 면만. 게임에선 두 단으로 끊긴 빛 웅덩이(본부실 책상 램프처럼).
    for (int i = 0; i < ${MAX_SITE_LIGHTS}; i++) {
      vec3 toLight = uLights[i] - vWorld;
      float fall = 1.0 / (1.0 + dot(toLight, toLight) * 0.03);
      float facing = max(dot(n, normalize(toLight)), 0.0);
      float band = mix(facing, 0.35 + 0.65 * step(0.3, facing), toon);
      lit += base * uLightColors[i] * fall * band * 1.2;
    }
    // 창·간판·LED 는 스스로 빛난다. 게임 모습에선 번지지 않게 눌러 평평한 색 면이 된다.
    lit += vColor * vGlow * mix(1.6, 0.85, uGame);

    lit = applyFog(lit, vWorld);
    lit += uSeamColor * glowSeam * 2.2;
    gl_FragColor = vec4(lit, 1.0);
  }
`;

/** 달빛 키 라이트 — 그림을 위해 앞쪽 왼편 위에서 비춘다(실제 달은 앞쪽 오른편 하늘). */
const KEY_DIRECTION = new THREE.Vector3(-0.5, 0.65, 0.57).normalize();

export interface SiteLights {
  positions: THREE.Vector3[];
  colors: THREE.Color[];
}

export function createSiteLights(): SiteLights {
  return {
    positions: Array.from({ length: MAX_SITE_LIGHTS }, () => new THREE.Vector3(0, -1e4, 0)),
    colors: Array.from({ length: MAX_SITE_LIGHTS }, () => new THREE.Color(0, 0, 0)),
  };
}

/** 자리별 값 — 매 프레임 Sites 가 morphs 를 고친다. shapes 는 (아래 끝[+SEAM_DOWN_FLAG], 위 끝, 방식). */
export interface SiteStates {
  morphs: number[];
  shapes: THREE.Vector3[];
}

export function createSiteMaterial(uniforms: SharedUniforms, lights: SiteLights, states: SiteStates, layer: SiteLayer) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uMorphs: { value: states.morphs },
      uShapes: { value: states.shapes },
      uLayer: { value: layer === "modern" ? 0 : 1 },
      uOutline: { value: layer === "outline" ? 1 : 0 },
      uInk: { value: PALETTE.ink.clone() },
      uSeamColor: { value: PALETTE.seam.clone() },
      uKeyDir: { value: KEY_DIRECTION },
      uLights: { value: lights.positions },
      uLightColors: { value: lights.colors },
    },
    vertexShader: vertexShader(states.morphs.length),
    fragmentShader: FRAGMENT,
    vertexColors: true,
    // Meshy 모형은 면 방향이 고르지 않다. 양면으로 그리고 법선은 셰이더가 뒤집는다. 외곽선 껍데기는 뒷면만.
    side: layer === "outline" ? THREE.BackSide : THREE.DoubleSide,
  });
}
