/**
 * 씬에 이미 선 소품을 기우제에 맞춰 움직이는 셰이더 덧댐 — 금줄 천자락 펄럭임 · 나룻배 까딱임.
 * 배치는 손대지 않고 그 메시의 재질만 제 것으로 떼어 꼭짓점에서 돌린다. 메시는 뒤늦게 서므로 1초마다 찾아본다.
 */
import * as THREE from "three";

/** 금줄 천자락 — 무리(한 덩이 지오)에서 천 색(흰 · 빨강 · 파랑)만 골라 아래쪽일수록 크게 펄럭인다 */
const ROPE_FLUTTER_GLSL = /* glsl */ `
  #include <begin_vertex>
  {
    // 꼭짓점 색이 선형이든 sRGB 든 걸리게 비율로 본다(짚 줄 · 기둥은 안 걸린다)
    bool isWhite = color.g > 0.5 && color.b > 0.5;
    bool isRed = color.r > 0.3 && color.r > color.g * 2.5;
    bool isBlue = color.b > color.r + 0.15;
    bool isCloth = isWhite || isRed || isBlue;
    float hang = isCloth ? clamp(0.93 - position.y, 0.0, 0.32) : 0.0;
    float phase = uRopeTime * 5.2 + position.x * 7.0;
    transformed.z += hang * uRopeWind * (0.42 * sin(phase) + 0.18 * sin(phase * 2.3 + 1.0));
    transformed.x += hang * uRopeWind * 0.14 * sin(phase * 0.7 + 2.0);
  }`;

/** 나룻배 — 물이 차면 떠올라 까딱이고, 물살에 끌려가다 밧줄에 걸린 듯 되돌아온다(유닛 → 배 자기 좌표) */
const BOAT_ROCK_GLSL = /* glsl */ `
  #include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      float sy = length(instanceMatrix[1].xyz);
      float seed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.007;
    #else
      float sy = 1.0;
      float seed = 0.0;
    #endif
    float t = uBoatTime;
    // 물살에 크게 기우뚱 — 옆으로 · 앞뒤로, 이따금 크게 한 번 더
    float gust = 0.5 + 0.5 * sin(t * 0.31 + seed * 2.0);
    float roll = uBoatRock * (0.12 * sin(t * 1.3 + seed * 7.0) + 0.045 * sin(t * 2.7 + seed * 3.0)) * (0.7 + 0.6 * gust);
    float pitch = uBoatRock * 0.07 * sin(t * 1.05 + seed * 5.0 + 1.0);
    // 뱃머리가 물살에 이리저리 돌아간다
    float yaw = uBoatRock * (0.16 * sin(t * 0.42 + seed * 2.3) + 0.05 * sin(t * 1.17 + seed));
    float cy = cos(yaw);
    float sy0 = sin(yaw);
    transformed.xz = vec2(cy * transformed.x - sy0 * transformed.z, sy0 * transformed.x + cy * transformed.z);
    float cr = cos(roll);
    float sr = sin(roll);
    transformed.xy = vec2(cr * transformed.x - sr * transformed.y, sr * transformed.x + cr * transformed.y);
    float cp = cos(pitch);
    float sp = sin(pitch);
    transformed.zy = vec2(cp * transformed.z - sp * transformed.y, sp * transformed.z + cp * transformed.y);
    transformed.y += (uBoatLift + uBoatRock * 0.25 * sin(t * 1.6 + seed * 4.0)) / sy;
    float drift = uBoatRock * (1.6 * max(0.0, sin(t * 0.36 + seed * 3.1)) + 0.3 * sin(t * 1.25 + seed));
    transformed.z += drift / sy;
    transformed.x += uBoatRock * 0.6 * sin(t * 0.5 + seed * 1.7) / sy;
  }`;

type Uniforms = Record<string, { value: number }>;

interface Patch {
  /** 찾을 메시 이름 */
  meshName: string;
  /** 덧댄 메시에 남기는 표시(userData 열쇠) · 셰이더 캐시 열쇠 */
  tag: string;
  uniforms: Uniforms;
  glsl: string;
}

/** 이름이 맞는 메시를 1초마다 찾아 한 번만 덧댄다 */
function createScenePatch({ meshName, tag, uniforms, glsl }: Patch) {
  let isDone = false;
  let nextTry = 0;
  const declarations = Object.keys(uniforms)
    .map((name) => `uniform float ${name};`)
    .join("\n");
  return {
    uniforms,
    tryPatch(scene: THREE.Scene, time: number) {
      if (isDone || time < nextTry) return;
      nextTry = time + 1;
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || mesh.name !== meshName || mesh.userData[tag]) return;
        // 재질을 이 무리만의 것으로 떼어 낸 뒤 흔들림을 붙인다 — 다른 무리는 그대로
        const material = (mesh.material as THREE.Material).clone();
        material.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\n${declarations}`)
            .replace("#include <begin_vertex>", glsl);
        };
        material.customProgramCacheKey = () => tag;
        mesh.material = material;
        mesh.userData[tag] = true;
        isDone = true;
      });
    },
  };
}

export const createRopeFlutter = () =>
  createScenePatch({
    meshName: "씬5.금줄",
    tag: "ropeFlutter",
    uniforms: { uRopeWind: { value: 0 }, uRopeTime: { value: 0 } },
    glsl: ROPE_FLUTTER_GLSL,
  });

export const createBoatRock = () =>
  createScenePatch({
    meshName: "소품.나룻배",
    tag: "boatRock",
    uniforms: { uBoatLift: { value: 0 }, uBoatRock: { value: 0 }, uBoatTime: { value: 0 } },
    glsl: BOAT_ROCK_GLSL,
  });
