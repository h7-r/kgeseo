/**
 * 첫 장면 인물 굽힘 — 뼈 없는 정지 모형(Meshy)을 정점 셰이더에서 부위별로 돌려 움직이게 한다(미르 11/8 「서 있기만 해서 뭔지 모르겠다」).
 *
 * 모형 공간(키 1 규약, 정면 +Z) 높이 · 옆 위치로 부위 가중치를 정하고, 가중치만큼 그 부위의 축 둘레로 돌린다 — 자동 가중치로 뼈를 심은 것과 같은 셈.
 * 자식 부위(팔 · 머리)를 먼저, 부모(허리 비틀기 · 숙이기)를 나중에 돌린다(관절 차례).
 *  - 아비사: A자세. 머리 y>0.82, 팔 |x|>0.15(어깨 아래), 치마 |x|<0.135 — 팔 소매 끝이 치마 옆에 닿아 있어 경계를 좁게 둔다.
 *  - 구렁이: 똬리 + S자로 세운 목. 목 밑동(0.14, 0.11, 0.33)에서 위로 갈수록 많이 돈다. 혀는 주둥이 앞 z>0.452.
 * 같은 굽힘을 보이는 재질 · 그림자(깊이) · 외곽선 셋에 다 넣어야 머리를 돌릴 때 선 · 그림자가 몸에서 떨어지지 않는다.
 */
import * as THREE from "three";

export type ActorKind = "abisa" | "serpent";

const ROTATE_GLSL = /* glsl */ `
vec3 bendRotate(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
vec3 bendAround(vec3 p, vec3 pivot, vec3 axis, float angle) {
  return pivot + bendRotate(p - pivot, axis, angle);
}
`;

/** 아비사 — 숨 · 팔(좌우) · 머리 · 허리 비틀기 · 숙이기 */
const ABISA_GLSL = /* glsl */ `
uniform float uBreath;
uniform float uHeadYaw;
uniform float uHeadPitch;
uniform float uTorsoYaw;
uniform float uBow;
uniform vec4 uArmL;
uniform vec4 uArmR;
uniform float uArmRest;
uniform vec2 uSway;
${ROTATE_GLSL}
void actorBend(inout vec3 p, inout vec3 n) {
  vec3 rest = p;
  // 숨 — 가슴 띠만 앞뒤로 아주 조금
  float chest = smoothstep(0.58, 0.66, rest.y) * (1.0 - smoothstep(0.74, 0.8, rest.y));
  p.z += rest.z * chest * uBreath;
  // 팔 — 어깨 아래 바깥쪽. 소매 끝이 치마 옆(|x| 0.125~0.135)과 닿아 경계를 좁게
  float armBand = (1.0 - smoothstep(0.765, 0.8, rest.y)) * step(0.38, rest.y);
  float wL = smoothstep(0.128, 0.16, rest.x) * armBand;
  float wR = (1.0 - smoothstep(-0.16, -0.128, rest.x)) * armBand;
  vec3 shoulderL = vec3(0.125, 0.765, 0.0);
  vec3 shoulderR = vec3(-0.125, 0.765, 0.0);
  // A자세로 벌어진 팔을 몸 쪽으로 조금 모은다(앞뒤 축 둘레, 왼팔은 −, 오른팔은 +)
  p = bendAround(p, shoulderL, vec3(0.0, 0.0, 1.0), -uArmRest * wL);
  n = bendRotate(n, vec3(0.0, 0.0, 1.0), -uArmRest * wL);
  p = bendAround(p, shoulderR, vec3(0.0, 0.0, 1.0), uArmRest * wR);
  n = bendRotate(n, vec3(0.0, 0.0, 1.0), uArmRest * wR);
  p = bendAround(p, shoulderL, uArmL.xyz, uArmL.w * wL);
  n = bendRotate(n, uArmL.xyz, uArmL.w * wL);
  p = bendAround(p, shoulderR, uArmR.xyz, uArmR.w * wR);
  n = bendRotate(n, uArmR.xyz, uArmR.w * wR);
  // 머리 — 목 위
  float wH = smoothstep(0.8, 0.86, rest.y);
  vec3 neck = vec3(0.0, 0.83, -0.005);
  p = bendAround(p, neck, vec3(1.0, 0.0, 0.0), uHeadPitch * wH);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), uHeadPitch * wH);
  p = bendAround(p, neck, vec3(0.0, 1.0, 0.0), uHeadYaw * wH);
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), uHeadYaw * wH);
  // 허리 위 — 팔은 몸통을 그대로 따라간다. 손을 아랫배 앞에 모은 자세(abisa-pose)는 배 앞으로 나온 팔 · 손도
  float front = smoothstep(0.1, 0.12, rest.z) * smoothstep(0.46, 0.49, rest.y) * (1.0 - smoothstep(0.68, 0.72, rest.y));
  float arms = max(max(wL, wR), front);
  float wT = max(smoothstep(0.55, 0.78, rest.y), arms);
  p = bendAround(p, vec3(0.0), vec3(0.0, 1.0, 0.0), uTorsoYaw * wT);
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), uTorsoYaw * wT);
  float wB = max(smoothstep(0.52, 0.66, rest.y), arms);
  vec3 waist = vec3(0.0, 0.58, 0.0);
  p = bendAround(p, waist, vec3(1.0, 0.0, 0.0), uBow * wB);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), uBow * wB);
  // 온몸 아주 작은 흔들림 — 발은 땅에 붙인 채 위로 갈수록
  float wS = smoothstep(0.0, 0.55, rest.y);
  p = bendAround(p, vec3(0.0), vec3(0.0, 0.0, 1.0), uSway.x * wS);
  n = bendRotate(n, vec3(0.0, 0.0, 1.0), uSway.x * wS);
  p = bendAround(p, vec3(0.0), vec3(1.0, 0.0, 0.0), uSway.y * wS);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), uSway.y * wS);
}
`;

/** 구렁이 — 숨 · 혀 · 목(좌우 · 들기) */
const SERPENT_GLSL = /* glsl */ `
uniform float uBreath;
uniform float uSnakeYaw;
uniform float uSnakeLift;
uniform float uTongue;
uniform vec3 uShift;
uniform float uGone;
${ROTATE_GLSL}
void actorBend(inout vec3 p, inout vec3 n) {
  vec3 rest = p;
  // 혀 — 주둥이 앞. 0 이면 주둥이 속으로 접힌다
  float wTongue = step(0.452, rest.z) * step(0.4, rest.y);
  vec3 snout = vec3(0.232, 0.49, 0.44);
  p = mix(p, snout + (p - snout) * uTongue, wTongue);
  // 숨 — 몸통이 아주 조금 부푼다(바닥에 닿은 아래는 그대로)
  p.y += rest.y * uBreath;
  // 목 — 밑동에서 위로 갈수록 많이 돈다. 똬리(낮은 몸)는 안 움직인다
  float wN = smoothstep(0.12, 0.44, rest.y) * smoothstep(0.15, 0.26, rest.z);
  vec3 base = vec3(0.14, 0.11, 0.33);
  p = bendAround(p, base, vec3(1.0, 0.0, 0.0), -uSnakeLift * wN);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), -uSnakeLift * wN);
  p = bendAround(p, base, vec3(0.0, 1.0, 0.0), uSnakeYaw * wN);
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), uSnakeYaw * wN);
  // 물러나기 — 통째로 미끄러지며 가라앉는다(모형 공간). 다 사라지면 한 점으로 접어 안 그린다
  p += uShift;
  p = mix(p, vec3(0.0, -50.0, 0.0), step(0.5, uGone));
}
`;

export interface AbisaPose {
  breath: number;
  /** A자세 팔을 몸 쪽으로 모으는 각(라디안) */
  armRest: number;
  /** 온몸 흔들림 — 좌우(x) · 앞뒤(y) */
  swayX: number;
  swayY: number;
  headYaw: number;
  headPitch: number;
  torsoYaw: number;
  bow: number;
  /** 팔 회전 — 축(xyz, 단위) + 각(w) */
  armL: THREE.Vector4;
  armR: THREE.Vector4;
}

export interface SerpentPose {
  breath: number;
  yaw: number;
  lift: number;
  /** 혀 내민 정도 0~1 */
  tongue: number;
  /** 물러나며 옮겨 간 만큼(모형 공간) */
  shift: THREE.Vector3;
  /** 다 사라졌다 */
  isGone: boolean;
}

export type BendUniforms = Record<string, THREE.IUniform>;

/**
 * 굽힘 값은 종류마다 하나만 둔다 — 재질에 한 번 심은 셰이더는 그때 받은 값 묶음을 계속 본다.
 * 장면이 다시 붙어 손잡이(ActorRig)가 새로 생겨도 같은 묶음을 쓰게(안 그러면 새 값이 셰이더에 안 닿아 자세가 굳는다).
 */
const SHARED_KEY = "__firstSceneBendUniforms";
export function bendUniformsFor(kind: ActorKind): BendUniforms {
  const store = ((globalThis as Record<string, unknown>)[SHARED_KEY] ??= {}) as Partial<
    Record<ActorKind, BendUniforms>
  >;
  return (store[kind] ??= createBendUniforms(kind));
}

export function createBendUniforms(kind: ActorKind): BendUniforms {
  if (kind === "abisa")
    return {
      uBreath: { value: 0 },
      uHeadYaw: { value: 0 },
      uHeadPitch: { value: 0 },
      uTorsoYaw: { value: 0 },
      uBow: { value: 0 },
      uArmL: { value: new THREE.Vector4(1, 0, 0, 0) },
      uArmR: { value: new THREE.Vector4(1, 0, 0, 0) },
      uArmRest: { value: 0 },
      uSway: { value: new THREE.Vector2() },
    };
  return {
    uBreath: { value: 0 },
    uSnakeYaw: { value: 0 },
    uSnakeLift: { value: 0 },
    uTongue: { value: 1 },
    uShift: { value: new THREE.Vector3() },
    uGone: { value: 0 },
  };
}

export function writeAbisaPose(uniforms: BendUniforms, pose: AbisaPose) {
  uniforms.uBreath.value = pose.breath;
  uniforms.uHeadYaw.value = pose.headYaw;
  uniforms.uHeadPitch.value = pose.headPitch;
  uniforms.uTorsoYaw.value = pose.torsoYaw;
  uniforms.uBow.value = pose.bow;
  (uniforms.uArmL.value as THREE.Vector4).copy(pose.armL);
  (uniforms.uArmR.value as THREE.Vector4).copy(pose.armR);
  uniforms.uArmRest.value = pose.armRest;
  (uniforms.uSway.value as THREE.Vector2).set(pose.swayX, pose.swayY);
}

export function writeSerpentPose(uniforms: BendUniforms, pose: SerpentPose) {
  uniforms.uBreath.value = pose.breath;
  uniforms.uSnakeYaw.value = pose.yaw;
  uniforms.uSnakeLift.value = pose.lift;
  uniforms.uTongue.value = pose.tongue;
  (uniforms.uShift.value as THREE.Vector3).copy(pose.shift);
  uniforms.uGone.value = pose.isGone ? 1 : 0;
}

const bendGlsl = (kind: ActorKind) => (kind === "abisa" ? ABISA_GLSL : SERPENT_GLSL);

/**
 * three 기본 재질(툰 · 깊이)에 굽힘을 심는다. 법선은 beginnormal 뒤(있으면), 자리는 begin_vertex 뒤에 굽힌다.
 * 깊이 재질처럼 법선 조각이 없는 셰이더도 자리만 굽혀 그대로 돈다.
 */
export function attachBend(material: THREE.Material, kind: ActorKind, uniforms: BendUniforms) {
  if (material.userData.firstSceneBend === kind) return;
  material.userData.firstSceneBend = kind;
  // 다른 훅(비에 젖는 재질 등)이 먼저 붙어 있으면 이어 부른다
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${bendGlsl(kind)}`)
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n{ vec3 bendP = position; actorBend(bendP, objectNormal); }",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n{ vec3 bendN = vec3(0.0, 1.0, 0.0); actorBend(transformed, bendN); }",
      );
  };
  material.customProgramCacheKey = () => `${previousKey()}|firstSceneBend:${kind}`;
  material.needsUpdate = true;
}

/**
 * drei Outlines 의 껍데기 재질에도 같은 굽힘을 심는다 — 머리를 돌려도 외곽선이 제자리에 남지 않게.
 * 그 셰이더는 begin_vertex 뒤 `vec4 tNormal = vec4(normal, 0.0);` 로 법선을 읽어 밀어내므로 굽힌 법선으로 바꿔 준다.
 */
export function attachOutlineBend(material: THREE.ShaderMaterial, kind: ActorKind, uniforms: BendUniforms) {
  if (material.userData.firstSceneBend === kind) return;
  material.userData.firstSceneBend = kind;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${bendGlsl(kind)}`)
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvec3 bentNormal = normal;\nactorBend(transformed, bentNormal);",
      )
      .replace("vec4 tNormal = vec4(normal, 0.0);", "vec4 tNormal = vec4(bentNormal, 0.0);");
  };
  material.customProgramCacheKey = () => `${previousKey()}|firstSceneBend:${kind}`;
  material.needsUpdate = true;
}

/** 그림자용 깊이 재질 — 굽힌 자리로 그림자가 진다 */
export function createBentDepthMaterial(kind: ActorKind, uniforms: BendUniforms) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  attachBend(material, kind, uniforms);
  return material;
}
