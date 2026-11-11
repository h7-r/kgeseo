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

export type ActorKind = "abisa" | "serpent" | PersonKind;
/** 두 번째 구역 어부 셋 — 공용 「사람」 굽힘에 모형마다 기준점만 다르다 */
export type PersonKind = "fisher" | "fisher2" | "fisher3";
export const isPersonKind = (kind: ActorKind): kind is PersonKind =>
  kind === "fisher" || kind === "fisher2" || kind === "fisher3";

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
uniform float uBodyYaw;
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
  // 온몸 돌리기 — 발밑 세로축 둘레. 말을 거는 사람 쪽으로 몸을 돌린다(등을 보인 채 말하지 않게)
  p = bendAround(p, vec3(0.0), vec3(0.0, 1.0, 0.0), uBodyYaw);
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), uBodyYaw);
}
`;

/**
 * 사람(어부) 기준점 — 모형 공간(키 1). 정점 단면 폭으로 쟀다(11/9, npc-face-hq 판):
 * 목은 단면이 가장 좁아지는 높이(어부 0.84~0.86 · 어부2 0.85~0.88 · 어부3 0.84~0.87), z 는 그 높이 앞뒤 폭의 가운데.
 * 팔은 그물 · 밧줄을 메고 있어 따로 돌리지 않는다(몸통을 따라간다).
 */
interface PersonBody {
  neck: [number, number, number];
  /** 머리 가중치가 0 → 1 로 오르는 높이 */
  headFrom: number;
  headTo: number;
  waist: number;
  /**
   * 손짓하는 팔(모형의 −x 쪽 아래팔 · 손) — 뼈대가 없어 자리로 가려낸다(블렌더 정면 렌더에서 잰 값).
   * elbow 팔꿈치, side 몸통과 팔을 가르는 x(이 사이에서 0 → 1), low 손끝 아래(바지 · 그물)를 빼는 y
   */
  arm: { elbow: [number, number, number]; side: [number, number]; low: [number, number] };
}
const PERSON_BODY: Record<PersonKind, PersonBody> = {
  fisher: {
    neck: [0, 0.835, 0.015],
    headFrom: 0.81,
    headTo: 0.855,
    waist: 0.58,
    arm: { elbow: [-0.165, 0.565, 0], side: [-0.118, -0.132], low: [0.375, 0.395] },
  },
  fisher2: {
    neck: [0, 0.84, 0.0],
    headFrom: 0.815,
    headTo: 0.86,
    waist: 0.58,
    arm: { elbow: [-0.175, 0.56, 0], side: [-0.125, -0.14], low: [0.375, 0.395] },
  },
  fisher3: {
    neck: [0, 0.835, 0.02],
    headFrom: 0.81,
    headTo: 0.855,
    waist: 0.58,
    arm: { elbow: [-0.165, 0.555, 0], side: [-0.125, -0.138], low: [0.375, 0.395] },
  },
};
/** 목 기준점(모형 공간) — 고개를 돌릴 각도를 여기서 잰다 */
export const personNeck = (kind: PersonKind) => new THREE.Vector3(...PERSON_BODY[kind].neck);
const glslNumber = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);

/** 사람 — 숨 · 머리(좌우 · 숙임) · 허리 비틀기 · 숙이기 · 흔들림(아비사와 같은 차례, 팔 없음) */
const personGlsl = (body: PersonBody) => /* glsl */ `
uniform float uBreath;
uniform float uHeadYaw;
uniform float uHeadPitch;
uniform float uTorsoYaw;
uniform float uBow;
uniform vec2 uSway;
uniform float uBodyYaw;
uniform float uArm;
${ROTATE_GLSL}
void actorBend(inout vec3 p, inout vec3 n) {
  vec3 rest = p;
  float chest = smoothstep(0.58, 0.66, rest.y) * (1.0 - smoothstep(0.74, 0.8, rest.y));
  p.z += rest.z * chest * uBreath;
  // 손짓 — 아래팔과 손을 팔꿈치에서 앞으로 든다(말할 때). 몸통 · 바지 · 소매 위쪽은 그대로
  vec3 elbow = vec3(${body.arm.elbow.map(glslNumber).join(", ")});
  float wA = (1.0 - smoothstep(${glslNumber(body.arm.side[1])}, ${glslNumber(body.arm.side[0])}, rest.x))
    * (1.0 - smoothstep(elbow.y - 0.01, elbow.y + 0.04, rest.y))
    * smoothstep(${glslNumber(body.arm.low[0])}, ${glslNumber(body.arm.low[1])}, rest.y);
  p = bendAround(p, elbow, vec3(1.0, 0.0, 0.0), -uArm * wA);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), -uArm * wA);
  float wH = smoothstep(${glslNumber(body.headFrom)}, ${glslNumber(body.headTo)}, rest.y);
  vec3 neck = vec3(${body.neck.map(glslNumber).join(", ")});
  p = bendAround(p, neck, vec3(1.0, 0.0, 0.0), uHeadPitch * wH);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), uHeadPitch * wH);
  p = bendAround(p, neck, vec3(0.0, 1.0, 0.0), uHeadYaw * wH);
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), uHeadYaw * wH);
  float wT = smoothstep(0.55, 0.78, rest.y);
  p = bendAround(p, vec3(0.0), vec3(0.0, 1.0, 0.0), uTorsoYaw * wT);
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), uTorsoYaw * wT);
  float wB = smoothstep(0.52, 0.66, rest.y);
  vec3 waist = vec3(0.0, ${glslNumber(body.waist)}, 0.0);
  p = bendAround(p, waist, vec3(1.0, 0.0, 0.0), uBow * wB);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), uBow * wB);
  float wS = smoothstep(0.0, 0.55, rest.y);
  p = bendAround(p, vec3(0.0), vec3(0.0, 0.0, 1.0), uSway.x * wS);
  n = bendRotate(n, vec3(0.0, 0.0, 1.0), uSway.x * wS);
  p = bendAround(p, vec3(0.0), vec3(1.0, 0.0, 0.0), uSway.y * wS);
  n = bendRotate(n, vec3(1.0, 0.0, 0.0), uSway.y * wS);
  // 온몸 돌리기 — 발밑 세로축 둘레. 말을 거는 사람 쪽으로 몸을 돌린다(등을 보인 채 말하지 않게)
  p = bendAround(p, vec3(0.0), vec3(0.0, 1.0, 0.0), uBodyYaw);
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), uBodyYaw);
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
uniform vec2 uWave;
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
  // 몸 물결 — 가는 쪽(uShift, 없으면 앞)으로 흘러가는 좌우 굽이. 통째로 밀려가는 대신 기어가는 듯이 보이게.
  // 가만히 있을 때도 아주 약하게 흘러 똬리가 굳은 돌처럼 보이지 않게 한다(uWave = 세기 · 흐른 만큼)
  vec2 along = length(uShift.xz) > 0.0001 ? normalize(uShift.xz) : vec2(0.0, 1.0);
  float waveAt = dot(rest.xz, along) * 13.0 - uWave.y;
  p.xz += vec2(-along.y, along.x) * sin(waveAt) * uWave.x;
  // 굽은 만큼 법선도 돌린다(세로축 둘레, 물결 기울기만큼) — 명암 · 외곽선이 굽은 몸을 따라가게(Codex 리뷰 2)
  n = bendRotate(n, vec3(0.0, 1.0, 0.0), -atan(uWave.x * 13.0 * cos(waveAt)));
  // 물러나기 — 통째로 미끄러지며 가라앉는다(모형 공간). 다 사라지면 한 점으로 접어 안 그린다
  p += uShift;
  p = mix(p, vec3(0.0, -50.0, 0.0), step(0.5, uGone));
}
`;

/**
 * 얼굴 — 눈 깜박임 · 말할 때 입. 얼굴이 그림 한 장이고 뼈대도 없어, 굽히기 전 모형 좌표(vRest)로 눈 · 입 자리를 짚어
 * 조각 셰이더에서 눈꺼풀색 · 입속색을 덧칠한다(11/11 움직임 점검 — 「인형처럼 눈을 안 깜박인다」). 고개를 돌려도 같이 간다.
 * 자리는 블렌더 정면 직교 렌더에서 잰 값(모형 공간, 키 = 1). eyes = [x, y] 둘, eyeSize = 반지름 [가로, 세로].
 */
interface ActorFace {
  eyes: [[number, number], [number, number]];
  eyeSize: [number, number];
  mouth: [number, number];
  mouthSize: [number, number];
  /** 눈꺼풀 · 속눈썹 줄 · 입속 색(sRGB) */
  lid: string;
  lash: string;
  inside: string;
  /** 이보다 앞(z)에 있는 면만 얼굴이다 — 뒤통수에는 그리지 않는다 */
  front: number;
}
const ACTOR_FACE: Record<PersonKind | "abisa", ActorFace> = {
  abisa: {
    eyes: [
      [-0.0195, 0.8755],
      [0.0235, 0.876],
    ],
    eyeSize: [0.0158, 0.0122],
    mouth: [-0.002, 0.8452],
    mouthSize: [0.0044, 0.0022],
    lid: "#f3d6ca",
    lash: "#2b2226",
    inside: "#8a4347",
    front: 0.03,
  },
  fisher: {
    eyes: [
      [-0.019, 0.893],
      [0.02, 0.893],
    ],
    eyeSize: [0.0082, 0.0046],
    mouth: [0, 0.8578],
    mouthSize: [0.0052, 0.0022],
    lid: "#d9c2b6",
    lash: "#3a2c28",
    inside: "#5a2a2a",
    front: 0.03,
  },
  fisher2: {
    eyes: [
      [-0.018, 0.902],
      [0.016, 0.902],
    ],
    eyeSize: [0.0075, 0.0036],
    mouth: [0, 0.867],
    mouthSize: [0.005, 0.002],
    lid: "#a38473",
    lash: "#2c211d",
    inside: "#4a2422",
    front: 0.03,
  },
  fisher3: {
    eyes: [
      [-0.022, 0.9],
      [0.018, 0.9],
    ],
    eyeSize: [0.0082, 0.0036],
    mouth: [0, 0.862],
    mouthSize: [0.005, 0.002],
    lid: "#b6998d",
    lash: "#4a3d38",
    inside: "#4f2a27",
    front: 0.03,
  },
};
const hasFace = (kind: ActorKind): kind is PersonKind | "abisa" => kind in ACTOR_FACE;
/** 셰이더 속 색은 선형 — sRGB 색을 바꿔 적는다 */
const glslColor = (hex: string) => {
  const color = new THREE.Color(hex);
  return `vec3(${color.r.toFixed(4)}, ${color.g.toFixed(4)}, ${color.b.toFixed(4)})`;
};
const glslVec2 = (v: [number, number]) => `vec2(${v.map(glslNumber).join(", ")})`;
const faceGlsl = (face: ActorFace) => /* glsl */ `
varying vec3 vRest;
uniform float uBlink;
uniform float uMouth;
void actorEye(inout vec3 color, vec2 center) {
  vec2 e = (vRest.xy - center) / ${glslVec2(face.eyeSize)};
  float inside = 1.0 - smoothstep(0.82, 1.0, length(e));
  // 윗눈꺼풀이 내려온 자리 — 뜬 눈(1) 에서 감은 눈(-0.55) 까지. 그 위는 살색, 가장자리에 속눈썹 줄.
  // 감길수록 줄이 아래로 둥글게 휜다(가운데가 처지고 양 끝이 올라간 감은 눈)
  float lid = 1.0 - uBlink * (1.55 + 0.3 * (1.0 - e.x * e.x));
  float shown = smoothstep(0.02, 0.12, uBlink);
  color = mix(color, ${glslColor(face.lid)}, inside * shown * smoothstep(lid - 0.1, lid + 0.1, e.y));
  color = mix(color, ${glslColor(face.lash)}, inside * shown * 0.85 * (1.0 - smoothstep(0.06, 0.26, abs(e.y - lid))));
}
void actorFace(inout vec3 color) {
  if (vRest.z < ${glslNumber(face.front)}) return;
  actorEye(color, ${glslVec2(face.eyes[0])});
  actorEye(color, ${glslVec2(face.eyes[1])});
  // 입 — 말할 때 입술 사이가 벌어진다(어두운 타원이 세로로 커졌다 작아졌다)
  vec2 m = (vRest.xy - ${glslVec2(face.mouth)}) / (${glslVec2(face.mouthSize)} * vec2(1.0, max(uMouth, 0.001)));
  color = mix(color, ${glslColor(face.inside)}, 0.8 * smoothstep(0.03, 0.12, uMouth) * (1.0 - smoothstep(0.55, 1.0, length(m))));
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
  /** 온몸을 세로축 둘레로 돌린 각(라디안) — 말을 거는 사람 쪽으로 */
  bodyYaw: number;
  /** 눈 감은 정도 0~1 · 입 벌린 정도 0~1(stepFace 가 쓴다) */
  blink: number;
  mouth: number;
  /** 팔 회전 — 축(xyz, 단위) + 각(w) */
  armL: THREE.Vector4;
  armR: THREE.Vector4;
}

export interface PersonPose {
  breath: number;
  swayX: number;
  swayY: number;
  headYaw: number;
  headPitch: number;
  torsoYaw: number;
  bow: number;
  /** 온몸을 세로축 둘레로 돌린 각(라디안) — 말을 거는 사람 쪽으로 */
  bodyYaw: number;
  /** 눈 감은 정도 0~1 · 입 벌린 정도 0~1(stepFace 가 쓴다) */
  blink: number;
  mouth: number;
  /** 손짓 — 아래팔을 앞으로 든 각(라디안) */
  arm: number;
}

export interface SerpentPose {
  breath: number;
  yaw: number;
  lift: number;
  /** 혀 내민 정도 0~1 */
  tongue: number;
  /** 물러나며 옮겨 간 만큼(모형 공간) */
  shift: THREE.Vector3;
  /** 몸 물결 세기(모형 공간 길이) — 기어갈 때 크게, 가만히 있을 때 아주 약하게 */
  wave: number;
  /** 몸 물결이 흘러간 만큼(라디안) */
  wavePhase: number;
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
  if (isPersonKind(kind))
    return {
      uBreath: { value: 0 },
      uHeadYaw: { value: 0 },
      uHeadPitch: { value: 0 },
      uTorsoYaw: { value: 0 },
      uBow: { value: 0 },
      uSway: { value: new THREE.Vector2() },
      uBodyYaw: { value: 0 },
      uBlink: { value: 0 },
      uMouth: { value: 0 },
      uArm: { value: 0 },
    };
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
      uBodyYaw: { value: 0 },
      uBlink: { value: 0 },
      uMouth: { value: 0 },
    };
  return {
    uBreath: { value: 0 },
    uSnakeYaw: { value: 0 },
    uSnakeLift: { value: 0 },
    uTongue: { value: 1 },
    uShift: { value: new THREE.Vector3() },
    uGone: { value: 0 },
    uWave: { value: new THREE.Vector2() },
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
  uniforms.uBodyYaw.value = pose.bodyYaw;
  uniforms.uBlink.value = pose.blink;
  uniforms.uMouth.value = pose.mouth;
}

export function writeSerpentPose(uniforms: BendUniforms, pose: SerpentPose) {
  uniforms.uBreath.value = pose.breath;
  uniforms.uSnakeYaw.value = pose.yaw;
  uniforms.uSnakeLift.value = pose.lift;
  uniforms.uTongue.value = pose.tongue;
  (uniforms.uShift.value as THREE.Vector3).copy(pose.shift);
  uniforms.uGone.value = pose.isGone ? 1 : 0;
  (uniforms.uWave.value as THREE.Vector2).set(pose.wave, pose.wavePhase);
}

export function writePersonPose(uniforms: BendUniforms, pose: PersonPose) {
  uniforms.uBreath.value = pose.breath;
  uniforms.uHeadYaw.value = pose.headYaw;
  uniforms.uHeadPitch.value = pose.headPitch;
  uniforms.uTorsoYaw.value = pose.torsoYaw;
  uniforms.uBow.value = pose.bow;
  (uniforms.uSway.value as THREE.Vector2).set(pose.swayX, pose.swayY);
  uniforms.uBodyYaw.value = pose.bodyYaw;
  uniforms.uBlink.value = pose.blink;
  uniforms.uMouth.value = pose.mouth;
  uniforms.uArm.value = pose.arm;
}

const bendGlsl = (kind: ActorKind) =>
  isPersonKind(kind) ? personGlsl(PERSON_BODY[kind]) : kind === "abisa" ? ABISA_GLSL : SERPENT_GLSL;

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
  // 얼굴(눈 깜박임 · 입)은 색을 그리는 재질에만 — 그림자용 깊이 재질에는 필요 없다
  const face = hasFace(kind) && !(material as THREE.MeshDepthMaterial).isMeshDepthMaterial ? ACTOR_FACE[kind] : null;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${face ? "varying vec3 vRest;\n" : ""}${bendGlsl(kind)}`)
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n{ vec3 bendP = position; actorBend(bendP, objectNormal); }",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${face ? "vRest = position;\n" : ""}{ vec3 bendN = vec3(0.0, 1.0, 0.0); actorBend(transformed, bendN); }`,
      );
    if (face)
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${faceGlsl(face)}`)
        .replace("#include <map_fragment>", "#include <map_fragment>\nactorFace(diffuseColor.rgb);");
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

/** 얼굴 시계 — 자세(pose)마다 하나. 다음 깜박임까지 남은 시간 · 깜박이는 중 흐른 시간(-1 이면 뜬 눈) */
const faceClocks = new WeakMap<object, { blinkIn: number; blinkTime: number; talkTime: number }>();
/** 깜박임 한 번 — 감기(0.07초) · 감은 채(0.04초) · 뜨기(0.11초) */
const BLINK = { close: 0.07, hold: 0.04, open: 0.11 };

/**
 * 눈 깜박임 · 말할 때 입을 한 장면 나아가게 한다. 깜박임은 2.4~6초에 한 번(가끔 두 번 잇달아),
 * 입은 말하는 동안만 음절처럼 여닫는다(두 빠르기를 섞어 기계처럼 고르지 않게).
 */
export function stepFace(pose: { blink: number; mouth: number }, dt: number, isSpeaking: boolean) {
  let clock = faceClocks.get(pose);
  if (!clock) {
    clock = { blinkIn: 1 + Math.random() * 3, blinkTime: -1, talkTime: Math.random() * 10 };
    faceClocks.set(pose, clock);
  }
  clock.blinkIn -= dt;
  if (clock.blinkIn <= 0 && clock.blinkTime < 0) {
    clock.blinkTime = 0;
    clock.blinkIn = Math.random() < 0.15 ? 0.32 : 2.4 + Math.random() * 3.6;
  }
  if (clock.blinkTime >= 0) {
    clock.blinkTime += dt;
    const t = clock.blinkTime;
    const openAt = BLINK.close + BLINK.hold;
    pose.blink = t < BLINK.close ? t / BLINK.close : t < openAt ? 1 : Math.max(0, 1 - (t - openAt) / BLINK.open);
    if (t >= openAt + BLINK.open) clock.blinkTime = -1;
  } else pose.blink = 0;
  clock.talkTime += dt;
  const beat = Math.abs(Math.sin(clock.talkTime * 10.5)) * (0.55 + 0.45 * Math.sin(clock.talkTime * 2.9 + 1));
  const want = isSpeaking ? Math.max(0, 0.15 + 0.85 * beat) : 0;
  pose.mouth += (want - pose.mouth) * (1 - Math.exp(-dt * 24));
  // 개발 서버에서 자리 · 색을 맞출 때 — 콘솔에서 __faceForce = { blink: 1, mouth: 1 } 로 굳혀 놓고 본다
  if (import.meta.env?.DEV) {
    const forced = (globalThis as { __faceForce?: { blink?: number; mouth?: number } }).__faceForce;
    if (forced?.blink !== undefined) pose.blink = forced.blink;
    if (forced?.mouth !== undefined) pose.mouth = forced.mouth;
  }
}
