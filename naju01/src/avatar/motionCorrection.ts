// 리타게팅한 클립에 걸어 주는 자세 보정 — 값과 계산을 한곳에 모은다.
//   gait.html 에서 켜고 끄며 원본 클립·원본 캐릭터와 나란히 비교한다.
// 값 단위: 이름 끝이 Scale 이면 배율(1 = 클립 그대로), footContact* 는 키 비율, 그 밖 숫자는 도(°).
import * as THREE from "three";

// 모델 기준 축 — Y 위, Z 앞, X 옆(glTF).
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);
const SIDE_AXIS = new THREE.Vector3(1, 0, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

export const LOCOMOTION_CLIPS: ReadonlySet<string> = new Set([
  "Walk_Loop",
  "Walk_Formal_Loop",
  "Jog_Fwd_Loop",
  "Sprint_Loop",
  "Crouch_Fwd_Loop",
]);
const WALK_CLIPS = new Set(["Walk_Loop", "Walk_Formal_Loop"]);

export interface CorrectionValues {
  enabled: boolean;
  /** 위팔을 몸 바깥으로 — 몸에 닿지 않을 만큼만 */
  armSpread: number;
  /** 걷기·달리기에서 팔을 도로 붙인다(armSpread 에서 뺀다). 걸을 땐 팔이 앞뒤로 흔들려 안 닿는다. */
  walkArmTuck: number;
  /** 위팔을 앞으로(+). 팔짱처럼 팔이 몸 앞에서 겹칠 때 손을 바깥으로 뺀다. */
  armForward: number;
  /** 쇄골을 앞으로(+). 클립이 어깨를 앞으로 말아 놓았을 때 되돌린다. */
  clavicleForward: number;
  /** 걷기·달리기에서 위팔을 제 길이 축 둘레로(+ 팔꿈치가 뒤로). 뒤에 곱한다. 아래팔에는 걸지 말 것. */
  walkArmRoll: number;
  /** 걷기·달리기에서 위팔을 뒤로(+). 클립은 팔을 몸 앞에서만 휘젓는다. */
  walkArmBack: number;
  /** 걷기·달리기 위팔 흔들림 폭. 팔이 짧아 같은 각이 더 크게 읽힌다. */
  armSwingScale: number;
  /** 걷기·달리기에서 팔꿈치 굽힘에서 뺄 각(0 밑으로는 안 내려간다) */
  elbowStraighten: number;
  /** 참이면 이동 동작이 아닌 클립에도 팔꿈치·손목 펴기를 건다(팔짱처럼 팔이 겹치는 자세) */
  elbowStraightenAlways: boolean;
  /** 팔마다 다르게 펼 때(null 이면 elbowStraighten) */
  leftElbowStraighten: number | null;
  rightElbowStraighten: number | null;
  /** 손목 굽힘에서 뺄 각. 팔꿈치 펴기와 같은 조건에서 걸린다. */
  wristStraighten: number;
  leftWristStraighten: number | null;
  rightWristStraighten: number | null;
  /** 걷기·달리기 골반·척추의 좌우 기울임 폭. 앞뒤 끄덕임·비틀림은 그대로. */
  bodySwayScale: number;
  /** 걷기·달리기 척추 비틀림 폭. 골반은 빼고 척추만 — 골반을 비틀면 다리가 끌려간다. */
  bodyTwistScale: number;
  /** 걷기·달리기에서 요추(spine_01)를 앞으로(+) */
  walkLean: number;
  /** 걷기·달리기에서 가슴(spine_03)·목(neck_01)을 뒤로(+). 요추를 숙이고 이걸 세우면 등이 아치가 된다. */
  walkChestLift: number;
  walkNeckLift: number;
  /** 걷기·달리기에서 골반만 앞으로(+). 허벅지·요추는 되돌려 상의 밑단만 앞이 내려간다. */
  walkPelvisTilt: number;
  /** 걷기·달리기 발 피치(+ 발끝 올림) */
  walkFootPitch: number;
  /** 걷기·달리기에서 허벅지를 앞으로(+) */
  walkLegForward: number;
  /** 걷기·달리기에서 다리를 안으로 모은다(+). 발은 같은 양 되돌려 평평하게. */
  walkLegGather: number;
  /** + 면 엉덩이가 뒤로(허벅지는 되돌려 다리는 제자리). 늘 켜져 대기에서 상체가 젖혀 보여 0 으로 둔다. */
  pelvisTilt: number;
  /** 요추(spine_01)를 골반 반대로 */
  lumbarCurve: number;
  /** 가슴(spine_03)을 세운다(+ 뒤로). spine_02 에 걸면 아랫배가 밀려 나온다. */
  chestLift: number;
  /** 걷기 클립 보폭 배율. 다리가 짧아 클립 보폭에선 앞발이 뜨므로 줄인다. */
  strideScale: number;
  /** 발 피치(+ 발끝 올림). 쉴 때 뒤꿈치가 10° 떠 있어 디딜 때 발끝부터 닿는 것을 되돌린다. */
  footPitch: number;
  /** 무릎 굽힘에서 뺄 각(배율로 줄였더니 행진하듯 걸어 빼기로 했다) */
  kneeStraighten: number;
  /** 목을 뒤로(+) */
  neckLift: number;
  /** 머리를 숙인다(+ 아래). Tripo 대기는 턱이 들려 대기에서만 내린다. */
  headBow: number;
  /** 접지 IK — 낮은 발이 땅에 있을 때 다른 발이 이 높이(키 비율) 안이면 그 다리를 내린다 */
  footContactWindow: number;
  /** 한 다리가 맡는 최대 높이(키 비율) */
  footContactDrop: number;
  /** 앞다리가 맡을 수 있는 최대 — 사실상 0. 남는 1cm 안팎은 그대로 둔다(원본도 떠 있다). */
  footContactFrontLimit: number;
  footContactEnabled: boolean;
  /** 무릎만 바깥으로(허벅지 a, 정강이 −2a, 발 a). 정강이가 짧아 발이 벌어져 보인다. */
  kneeSpread: number;
  /** 서 있을 때 다리를 벌린다(+ 바깥). 종아리를 안 되돌려 발까지 벌어진다. */
  legSpread: number;
  /** 발끝을 안으로(+) */
  footToeIn: number;
  /** 발마다 다르게 돌릴 때(null 이면 footToeIn) */
  leftFootToeIn: number | null;
  rightFootToeIn: number | null;
  /** 대기(Idle_Loop) 클립에만 덧씌울 값 */
  idleOverrides?: Partial<CorrectionValues>;
  /** 팔짱(Idle_Fold_Loop) 클립에만 덧씌울 값 */
  foldOverrides?: Partial<CorrectionValues>;
}

export type CorrectionOverrides = Partial<CorrectionValues>;

// 이 캐릭터는 팔이 짧고 골반이 넓어 팔이 몸을 파고들고 걸을 때 허리가 과하게 숙여진다.
// 클립을 고치는 대신 본 몇 개를 조금 돌린다. 무릎은 끝까지 펴지 않는다 — 원본 걷기도 최소 10.8°
// 굽혀 있고, 억지로 펴면 발의 상하 이동이 커져 행진하듯 걷는다.
// 팔을 옆축 둘레로 돌리는 보정은 쓰지 않는다 — 쉴 때 팔이 X 를 향해 그 축 회전은 비틀림이고,
// 비틀림 뼈에 웨이트가 없어 아래팔이 통째로 돌아 팔꿈치가 틀어져 보인다.
export const DEFAULT_CORRECTION: CorrectionValues = {
  enabled: true,
  armSpread: 10,
  walkArmTuck: 8,
  armForward: 0,
  clavicleForward: 0,
  // 우리 클립은 팔꿈치가 옆으로 벌어지며 접혀(옆/뒤 성분비 1.14, 원본 0.21) 팔이 엇나가 보인다.
  walkArmRoll: 0,
  walkArmBack: 10,
  armSwingScale: 0.7,
  elbowStraighten: 10,
  elbowStraightenAlways: false,
  leftElbowStraighten: null,
  rightElbowStraighten: null,
  wristStraighten: 0,
  leftWristStraighten: null,
  rightWristStraighten: null,
  bodySwayScale: 0.55,
  bodyTwistScale: 1,
  walkLean: 0,
  walkChestLift: 0,
  walkNeckLift: 0,
  walkPelvisTilt: 0,
  walkFootPitch: 0,
  walkLegForward: 0,
  walkLegGather: 4,
  pelvisTilt: 0,
  lumbarCurve: 0,
  chestLift: 8,
  // 보폭을 키우면 발이 호를 그리며 올라가 앞발이 높은 곳을 딛는 듯 보인다(앞뒤발 높이차 원본 0.054,
  // 1.2배 0.074). 접지 IK 를 넣은 뒤엔 오히려 줄인다 — 다리가 짧아 클립 보폭에선 앞발이 뜬다.
  strideScale: 0.8,
  footPitch: 10,
  // 접지 IK 가 디딜 때 다리를 뻗어 주므로 4 로 낮춘다(8 + IK 는 너무 반듯하다. 원본은 11~27°).
  kneeStraighten: 4,
  neckLift: 0,
  headBow: 0,
  footContactWindow: 0.07,
  footContactDrop: 0.02,
  // 거의 뻗은 다리는 1.5cm 만 더 내려도 무릎이 15°→2° 로 잠겨 '힘줘 뻗는' 경직이 된다.
  footContactFrontLimit: 0.003,
  footContactEnabled: true,
  // 무릎→발목 좌우 벌어짐은 원본과 같은데 정강이가 짧아 더 가파르게 읽힌다.
  kneeSpread: 3,
  legSpread: 0,
  footToeIn: 0,
  leftFootToeIn: null,
  rightFootToeIn: null,
};

// 성별별 덧값 — 같은 클립·보정인데 몸체가 달라 다르게 읽힌다.
//   남성 몸체는 등이 곧은 판이라 가슴을 더 세운다. 목은 가슴과 반대 부호로 되돌려 머리는 클립대로 둔다
//   (가슴을 세우면 자식인 목·머리가 같이 젖혀져 턱이 든다). 가슴 12 면 몸통이 원본보다 4° 더 젖혀진다.
//   남성 발 살은 뼈보다 5~8° 바깥으로 틀어져 있어 발끝을 안으로 돌리고, 어깨가 넓어 걸을 때 팔을 더 붙인다.
//   허벅지가 길고 종아리가 짧아 같은 굽힘이 더 구부정해 무릎을 더 펴고 접지 내림도 줄인다.
//   골반 기울기는 0 — 기울이면 고관절이 뒤로 밀려 몸이 발보다 뒤에 앉은 꼴이 된다.
export const GENDER_CORRECTION: Record<"masculine" | "feminine", CorrectionOverrides> = {
  masculine: {
    chestLift: 14,
    neckLift: -10,
    pelvisTilt: 0,
    lumbarCurve: 0,
    footToeIn: 4,
    walkArmTuck: 12,
    walkLean: 5,
    kneeStraighten: 10,
    footContactDrop: 0.012,
  },
  feminine: { chestLift: 8, neckLift: -8, walkLean: 4, walkLegForward: 6 },
};

// Tripo 클립(우리 몸체에 맞춰 만든 걷기·대기·달리기)용. 자세는 이미 맞아 대부분 0 이고 팔만 벌린다 —
// Tripo 리그는 어깨가 좁아 걸을 때 팔이 골반을 뚫고 대기 때 손이 몸에 파묻힌다.
export const TRIPO_CORRECTION: CorrectionValues = {
  ...DEFAULT_CORRECTION,
  // 어깨 기본값(1.15)이 넓힌 만큼 덜 벌린다.
  armSpread: 10,
  walkArmTuck: 0,
  walkArmBack: 0,
  armSwingScale: 1,
  elbowStraighten: 0,
  bodySwayScale: 1,
  bodyTwistScale: 1,
  // 좌우 팔 흔들림 폭이 3cm 어긋나 있지만 한 축 회전으로는 못 잰다 — 그대로 둔다.
  // 팔 롤은 0 — 비틀림 뼈에 웨이트가 없어 어깨 세모근이 통째로 돈다.
  walkArmRoll: 0,
  pelvisTilt: 0,
  lumbarCurve: 0,
  chestLift: 0,
  neckLift: 0,
  strideScale: 1,
  footPitch: 0,
  kneeStraighten: 0,
  kneeSpread: 0,
  legSpread: 0,
  headBow: 0,
  walkLean: 0,
  walkLegForward: 0,
  walkLegGather: 0,
  // 팔자걸음 교정 — 디딜 때 발끝이 왼 12°, 오른 5.6° 바깥을 본다. 대기는 일부러 벌린 자세라 열린 채 남는다.
  footToeIn: 0,
  leftFootToeIn: 10,
  rightFootToeIn: 4,
  // 걷기 자세는 성별별 덧값에서 편다.
  walkChestLift: 0,
  walkNeckLift: 0,
  walkPelvisTilt: 0,
  // 디딜 때 발이 쉴 때보다 7° 들려 발 앞이 떠 보인다.
  walkFootPitch: -6,
  // 발이 이미 땅에 있어 IK 가 디딘 다리를 굽히면 걸음마다 무릎이 튕긴다.
  footContactEnabled: false,
};

// Tripo 걷기·달리기의 성별별 덧값.
//   남성 걷기는 요추가 뒤로, 목이 앞으로 나가 거북목처럼 구부정하다. 요추를 숙이고 가슴을 세우고,
//   요추 숙임 + 가슴 세움만큼 목을 되돌려 머리는 클립대로 둔다. 상체가 굳어 보여 척추 비틀림을 키운다.
//   남성 발 살은 뼈보다 바깥으로 틀어져 4° 더 돌린다. 골반은 18° 면 엉덩이 살이 꺾여 절반만 기울인다.
//   대기는 남녀가 같은 클립(허리에 손)이라 남성만 다리를 벌려 구분한다.
//   여성 대기는 골반이 앞으로 기울고 요추가 젖혀져 허리가 꺾여 보여, 골반을 말고 요추를 되세운다.
export const TRIPO_GENDER_CORRECTION: Record<"masculine" | "feminine", CorrectionOverrides> = {
  masculine: {
    walkLean: 14,
    bodyTwistScale: 1.4,
    walkChestLift: 15,
    walkNeckLift: -5,
    leftFootToeIn: 14,
    rightFootToeIn: 8,
    walkLegGather: -3,
    walkPelvisTilt: 9,
    idleOverrides: { legSpread: 5, headBow: 10 },
  },
  feminine: { idleOverrides: { lumbarCurve: -20, pelvisTilt: -20, headBow: 10 } },
};

/** 보정이 걸린 뼈마다 미리 만들어 두는 값 */
export interface BoneCorrection {
  /** 모든 클립에 앞에 곱할 회전 */
  rotation?: THREE.Quaternion;
  /** 이동 클립에만 앞에 곱할 회전 */
  moveRotation?: THREE.Quaternion;
  /** 쉴 때 회전 — 굽힘을 이것 대비로 잰다 */
  knee?: THREE.Quaternion;
  stride?: THREE.Quaternion;
  elbow?: THREE.Quaternion;
  wrist?: THREE.Quaternion;
  armSwing?: boolean;
  swayAxis?: THREE.Vector3;
  twistAxis?: THREE.Vector3;
  rollAxis?: THREE.Vector3;
  rollSign?: number;
}

export type CorrectionTable = Map<string, BoneCorrection>;

const KNEE_BONES = ["calf_l", "calf_r"];
const STRIDE_BONES = ["thigh_l", "thigh_r"];
const ELBOW_BONES = ["lowerarm_l", "lowerarm_r"];
const WRIST_BONES = ["hand_l", "hand_r"];
const SWAY_BONES = ["pelvis", "spine_01", "spine_02", "spine_03"];
const TWIST_BONES = ["spine_01", "spine_02", "spine_03"];
const ARM_SWING_BONES = ["upperarm_l", "upperarm_r"];
// 제 길이 축 둘레로 돌릴 뼈 — [뼈, 길이 방향을 재는 자식, 부호]
const ARM_ROLL_BONES: [string, string, number][] = [
  ["upperarm_l", "lowerarm_l", 1],
  ["upperarm_r", "lowerarm_r", -1],
];

/** [뼈 이름, 모델 기준 축, 각(도), 이동 동작에만인가] */
type PoseRule = [string, THREE.Vector3, number | null, boolean];

// 보정은 매 프레임 본을 돌리지 않고 리타게팅된 클립 키프레임에 한 번 넣는다.
// 매 프레임 돌리면 믹서가 값을 안 쓰는 프레임에 보정이 쌓여 팔이 머리 위로 올라간다.
const getPoseRules = (v: CorrectionValues): PoseRule[] => [
  ["upperarm_l", FORWARD_AXIS, v.armSpread, false],
  ["upperarm_r", FORWARD_AXIS, -v.armSpread, false],
  // 왼팔은 +x 를 향하므로 위축 둘레 −가 앞이다(오른팔은 반대).
  ["upperarm_l", UP_AXIS, -v.armForward, false],
  ["upperarm_r", UP_AXIS, v.armForward, false],
  ["clavicle_l", UP_AXIS, -v.clavicleForward, false],
  ["clavicle_r", UP_AXIS, v.clavicleForward, false],
  ["upperarm_l", FORWARD_AXIS, -v.walkArmTuck, true],
  ["upperarm_r", FORWARD_AXIS, v.walkArmTuck, true],
  ["upperarm_l", SIDE_AXIS, v.walkArmBack, true],
  ["upperarm_r", SIDE_AXIS, v.walkArmBack, true],
  ["foot_l", SIDE_AXIS, -v.walkFootPitch, true],
  ["foot_r", SIDE_AXIS, -v.walkFootPitch, true],
  ["pelvis", SIDE_AXIS, v.walkPelvisTilt, true],
  ["thigh_l", SIDE_AXIS, -v.walkPelvisTilt, true],
  ["thigh_r", SIDE_AXIS, -v.walkPelvisTilt, true],
  ["spine_01", SIDE_AXIS, v.walkLean - v.walkPelvisTilt, true],
  ["spine_03", SIDE_AXIS, -v.walkChestLift, true],
  ["neck_01", SIDE_AXIS, -v.walkNeckLift, true],
  ["thigh_l", SIDE_AXIS, -v.walkLegForward, true],
  ["thigh_r", SIDE_AXIS, -v.walkLegForward, true],
  // 왼다리는 앞축 둘레 +가 바깥(무릎 벌림과 같은 부호 규칙).
  ["thigh_l", FORWARD_AXIS, -v.walkLegGather, true],
  ["thigh_r", FORWARD_AXIS, v.walkLegGather, true],
  ["foot_l", FORWARD_AXIS, v.walkLegGather, true],
  ["foot_r", FORWARD_AXIS, -v.walkLegGather, true],
  ["pelvis", SIDE_AXIS, v.pelvisTilt, false],
  // 골반을 기울이면 자식인 다리도 같이 돈다 — 허벅지를 같은 양 되돌려 다리는 제자리에 둔다.
  ["thigh_l", SIDE_AXIS, -v.pelvisTilt, false],
  ["thigh_r", SIDE_AXIS, -v.pelvisTilt, false],
  ["spine_01", SIDE_AXIS, -v.lumbarCurve, false],
  // 가슴·목 세우기는 모든 동작에 건다. 걷기에만 걸면 대기·걷기 사이에 자세가 튄다.
  ["spine_03", SIDE_AXIS, -v.chestLift, false],
  ["neck_01", SIDE_AXIS, -v.neckLift, false],
  ["head", SIDE_AXIS, v.headBow, false],
  ["foot_l", SIDE_AXIS, -v.footPitch, false],
  ["foot_r", SIDE_AXIS, -v.footPitch, false],
  ["thigh_l", FORWARD_AXIS, v.legSpread, false],
  ["thigh_r", FORWARD_AXIS, -v.legSpread, false],
  ["foot_l", FORWARD_AXIS, -v.legSpread, false],
  ["foot_r", FORWARD_AXIS, v.legSpread, false],
  ["thigh_l", FORWARD_AXIS, v.kneeSpread, false],
  ["thigh_r", FORWARD_AXIS, -v.kneeSpread, false],
  ["calf_l", FORWARD_AXIS, -2 * v.kneeSpread, false],
  ["calf_r", FORWARD_AXIS, 2 * v.kneeSpread, false],
  ["foot_l", FORWARD_AXIS, v.kneeSpread, false],
  ["foot_r", FORWARD_AXIS, -v.kneeSpread, false],
  // 발끝 안쪽 돌림 — 위축 둘레. 왼발은 +가 바깥이라 부호를 뒤집는다.
  ["foot_l", UP_AXIS, -(v.leftFootToeIn ?? v.footToeIn), false],
  ["foot_r", UP_AXIS, v.rightFootToeIn ?? v.footToeIn, false],
];

// 쉴 때 자세에서 그 뼈의 부모까지 쌓인 회전 — 모델 기준 축을 부모 기준으로 옮길 때 쓴다.
function computeParentRestRotation(bone: THREE.Object3D): THREE.Quaternion {
  const out = new THREE.Quaternion();
  for (let node = bone.parent; node && node instanceof THREE.Bone; node = node.parent) out.premultiply(node.quaternion);
  return out;
}

function mergeBoneCorrection(table: CorrectionTable, name: string, patch: BoneCorrection) {
  table.set(name, { ...(table.get(name) ?? {}), ...patch });
}

/** 쉴 때 자세 기준으로 뼈마다 보정 회전·축을 미리 만든다. */
export function computeCorrectionTable(skin: THREE.SkinnedMesh, values: CorrectionValues): CorrectionTable {
  skin.skeleton.pose();
  const out: CorrectionTable = new Map();
  getPoseRules(values).forEach(([name, axisInModel, degrees, moveOnly]) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (!bone || !degrees) return;
    const axis = axisInModel.clone().applyQuaternion(computeParentRestRotation(bone).invert()).normalize();
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(degrees));
    // 같은 뼈에 여러 축이 걸리면 곱해 쌓는다. '늘'과 '이동 중에만'은 따로 쌓는다(팔벌림 + 걷기팔붙임).
    const entry = out.get(name) ?? {};
    const key = moveOnly ? "moveRotation" : "rotation";
    const previous = entry[key];
    entry[key] = previous ? rotation.multiply(previous) : rotation;
    out.set(name, entry);
  });
  KNEE_BONES.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) mergeBoneCorrection(out, name, { knee: bone.quaternion.clone() });
  });
  STRIDE_BONES.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) mergeBoneCorrection(out, name, { stride: bone.quaternion.clone() });
  });
  ELBOW_BONES.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) mergeBoneCorrection(out, name, { elbow: bone.quaternion.clone() });
  });
  WRIST_BONES.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) mergeBoneCorrection(out, name, { wrist: bone.quaternion.clone() });
  });
  ARM_SWING_BONES.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (bone) mergeBoneCorrection(out, name, { armSwing: true });
  });
  SWAY_BONES.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (!bone) return;
    // 모델 앞축을 이 뼈의 쉴 때 로컬 프레임으로 옮긴다(뼈 세계 회전의 역).
    const world = computeParentRestRotation(bone).multiply(bone.quaternion);
    const axis = FORWARD_AXIS.clone().applyQuaternion(world.invert()).normalize();
    mergeBoneCorrection(out, name, { swayAxis: axis });
  });
  ARM_ROLL_BONES.forEach(([name, childName, sign]) => {
    const bone = skin.skeleton.getBoneByName(name);
    const child = skin.skeleton.getBoneByName(childName);
    if (!bone || !child) return;
    // 자식 위치는 이 뼈의 부모 기준이 아니라 이 뼈 기준으로 옮겨야 제 길이 축이 된다.
    const axis = child.position.clone().normalize().applyQuaternion(bone.quaternion.clone().invert()).normalize();
    mergeBoneCorrection(out, name, { rollAxis: axis, rollSign: sign });
  });
  TWIST_BONES.forEach((name) => {
    const bone = skin.skeleton.getBoneByName(name);
    if (!bone) return;
    const world = computeParentRestRotation(bone).multiply(bone.quaternion);
    const axis = UP_AXIS.clone().applyQuaternion(world.invert()).normalize();
    mergeBoneCorrection(out, name, { twistAxis: axis });
  });
  return out;
}

// 클립 전체의 평균 회전 — 보폭을 키울 때 가운데로 삼는다. 쉴 때 자세를 가운데로 쓰면
// 걷기 허벅지 평균이 앞으로 치우쳐 있어 앞으로만 더 나가고 뒤로는 안 뻗는다.
function computeMeanRotation(track: THREE.KeyframeTrack): THREE.Quaternion {
  const sum = new THREE.Quaternion(0, 0, 0, 0);
  const q = new THREE.Quaternion();
  const reference = new THREE.Quaternion().fromArray(track.values, 0);
  let count = 0;
  for (let i = 0; i < track.values.length; i += 4) {
    q.fromArray(track.values, i);
    const sign = q.dot(reference) < 0 ? -1 : 1;
    sum.x += q.x * sign;
    sum.y += q.y * sign;
    sum.z += q.z * sign;
    sum.w += q.w * sign;
    count += 1;
  }
  if (!count) return reference;
  sum.set(sum.x / count, sum.y / count, sum.z / count, sum.w / count);
  return sum.normalize();
}

// 중심 자세에서 벗어난 각을 배율만큼 키우거나 줄인다(축은 그대로).
function applyAngleScale(track: THREE.KeyframeTrack, center: THREE.Quaternion, scale: number) {
  const centerInverse = center.clone().invert();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  for (let i = 0; i < track.values.length; i += 4) {
    const r = centerInverse.clone().multiply(q.fromArray(track.values, i));
    // w < 0 이면 같은 회전의 긴 쪽 표현이라 −r 로 바꾼 뒤 축·각을 읽는다.
    //   축과 각에 부호를 따로 곱하면 역회전이 되어, 무릎이 120° 넘게 굽는 키만 뒤집혀 다리가 뒤틀린다.
    if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(r.w, -1, 1));
    if (angle < 1e-5) continue;
    const sin = Math.sqrt(Math.max(0, 1 - r.w * r.w));
    axis.set(r.x, r.y, r.z).divideScalar(sin);
    r.setFromAxisAngle(axis.normalize(), angle * scale);
    center.clone().multiply(r).toArray(track.values, i);
  }
}

// 중심 자세에서 벗어난 회전 중 axis 둘레 성분(비틀림)만 배율로 바꾼다. 흔듦은 그대로(swing-twist 분해).
function applyTwistScale(track: THREE.KeyframeTrack, center: THREE.Quaternion, axis: THREE.Vector3, scale: number) {
  const centerInverse = center.clone().invert();
  const q = new THREE.Quaternion();
  const twist = new THREE.Quaternion();
  for (let i = 0; i < track.values.length; i += 4) {
    const r = centerInverse.clone().multiply(q.fromArray(track.values, i));
    if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
    const projection = r.x * axis.x + r.y * axis.y + r.z * axis.z;
    twist.set(axis.x * projection, axis.y * projection, axis.z * projection, r.w).normalize();
    const swing = r.clone().multiply(twist.clone().invert());
    const angle = 2 * Math.atan2(projection, r.w);
    const scaled = new THREE.Quaternion().setFromAxisAngle(axis, angle * scale);
    center.clone().multiply(swing.multiply(scaled)).toArray(track.values, i);
  }
}

// 허벅지가 앞으로 나간 정도 — 키마다. 쉴 때 대비 옆축 회전각(도).
function measureForwardReach(thighTrack: THREE.KeyframeTrack, rest: THREE.Quaternion) {
  const restInverse = rest.clone().invert();
  const q = new THREE.Quaternion();
  const angles = new Float32Array(thighTrack.values.length / 4);
  for (let i = 0, k = 0; i < thighTrack.values.length; i += 4, k += 1) {
    const r = restInverse.clone().multiply(q.fromArray(thighTrack.values, i));
    angles[k] = 2 * Math.atan2(r.x, r.w) * (180 / Math.PI);
  }
  // 어느 부호가 앞인지는 클립마다 재지 않고, 평균보다 앞으로 간 쪽을 앞으로 본다.
  const mean = angles.reduce((a, b) => a + b, 0) / angles.length;
  // Float32Array.map 이라 차이도 float32 로 반올림된다 — 가중치가 바뀌지 않게 그대로 둔다.
  const range = Math.max(1e-3, ...angles.map((value) => Math.abs(value - mean)));
  return { angles, mean, range };
}

// 쉴 때 자세에서 벗어난 각에서 일정 각을 뺀다(0 밑으로는 안 내려간다).
//   weights 를 주면 키마다 그 비율만큼만 뺀다 — 앞으로 뻗은 다리만 펴고 뒤로 미는 다리는 둬야
//   뒤꿈치가 제때 떨어진다(전부 폈더니 뒷발에 오래 실려 몸이 디딘 발보다 앞에 머물렀다).
function applyAngleReduction(
  track: THREE.KeyframeTrack,
  rest: THREE.Quaternion,
  degrees: number | null,
  weights: Float32Array | null = null,
) {
  if (!degrees) return;
  const radians = THREE.MathUtils.degToRad(degrees);
  const restInverse = rest.clone().invert();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  for (let i = 0, k = 0; i < track.values.length; i += 4, k += 1) {
    const r = restInverse.clone().multiply(q.fromArray(track.values, i));
    if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(r.w, -1, 1));
    if (angle < 1e-5) continue;
    const ratio = weights ? weights[k] : 1;
    if (ratio <= 0) continue;
    const sin = Math.sqrt(Math.max(0, 1 - r.w * r.w));
    axis.set(r.x, r.y, r.z).divideScalar(sin);
    r.setFromAxisAngle(axis.normalize(), Math.max(0, angle - radians * ratio));
    rest.clone().multiply(r).toArray(track.values, i);
  }
}

// 트랙 이름은 "upperarm_l.quaternion" 일 수도 ".bones[upperarm_l].quaternion" 일 수도 있다.
const TRACK_BONE_NAME = /(?:\.bones\[)?([^.[\]]+)\]?\.quaternion$/;

/** 리타게팅된 클립의 키프레임에 보정을 직접 넣는다(clip 을 고쳐 돌려준다). */
export function applyClipCorrection(
  clip: THREE.AnimationClip,
  table: CorrectionTable | null,
  clipName: string,
  values: CorrectionValues,
): THREE.AnimationClip {
  const isMoving = LOCOMOTION_CLIPS.has(clipName);
  const isWalking = WALK_CLIPS.has(clipName);
  // 뼈 이름 → 트랙. 무릎은 같은 쪽 허벅지 트랙을 봐야 앞뒤를 안다.
  const tracksByBone = new Map<string, THREE.KeyframeTrack>();
  clip.tracks.forEach((track) => {
    const match = TRACK_BONE_NAME.exec(track.name);
    if (match) tracksByBone.set(match[1], track);
  });
  // 허벅지는 보폭 확대 뒤의 값으로 앞뒤를 재야 하므로 무릎보다 먼저 처리한다.
  const ordered = [...clip.tracks].sort((a, b) => {
    const ka = TRACK_BONE_NAME.exec(a.name)?.[1] ?? "";
    const kb = TRACK_BONE_NAME.exec(b.name)?.[1] ?? "";
    return (ka.startsWith("calf") ? 1 : 0) - (kb.startsWith("calf") ? 1 : 0);
  });
  ordered.forEach((track) => {
    const match = TRACK_BONE_NAME.exec(track.name);
    if (!match) return;
    const boneName = match[1];
    const rule = table?.get(boneName);
    if (!rule) return;
    const q = new THREE.Quaternion();
    if (rule.knee && isMoving) {
      const side = boneName.endsWith("_l") ? "l" : "r";
      const thigh = tracksByBone.get(`thigh_${side}`);
      const thighRule = table?.get(`thigh_${side}`);
      let weights: Float32Array | null = null;
      if (thigh && thighRule?.stride && thigh.values.length === track.values.length) {
        const { angles, mean, range } = measureForwardReach(thigh, thighRule.stride);
        // 어느 부호가 앞인가는 클립에서 읽는다: 무릎이 가장 곧은 키(디디는 순간)에 허벅지가 평균에서 벗어난 쪽.
        const restInverse = rule.knee.clone().invert();
        let straightKey = 0;
        let minBend = Infinity;
        for (let i = 0, k = 0; i < track.values.length; i += 4, k += 1) {
          const r = restInverse.clone().multiply(q.fromArray(track.values, i));
          const bend = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(r.w), -1, 1));
          if (bend < minBend) {
            minBend = bend;
            straightKey = k;
          }
        }
        const direction = Math.sign(angles[straightKey] - mean) || 1;
        // 평균보다 앞으로 나간 만큼 0~1. 뒤로 간 키는 0 — 그대로 둔다.
        weights = Float32Array.from(angles, (value) =>
          THREE.MathUtils.clamp((direction * (value - mean)) / range, 0, 1),
        );
      }
      applyAngleReduction(track, rule.knee, values.kneeStraighten, weights);
      // 무릎에도 축 회전(kneeSpread)이 걸리므로 아래로 이어 간다.
    }
    // 허벅지는 보폭 확대(걷기 클립만)와 골반 되돌림(늘)이 같이 걸린다.
    if (rule.stride && isWalking) applyAngleScale(track, computeMeanRotation(track), values.strideScale);
    // 팔: 흔들림 폭은 클립 평균을 가운데로 줄이고, 팔꿈치는 쉴 때 대비 굽힘에서 뺀다.
    if (rule.armSwing && isMoving && values.armSwingScale !== 1) {
      applyAngleScale(track, computeMeanRotation(track), values.armSwingScale);
    }
    if (rule.elbow && (isMoving || values.elbowStraightenAlways)) {
      const degrees =
        (boneName.endsWith("_l") ? values.leftElbowStraighten : values.rightElbowStraighten) ?? values.elbowStraighten;
      applyAngleReduction(track, rule.elbow, degrees);
    }
    if (rule.wrist && (isMoving || values.elbowStraightenAlways)) {
      const degrees =
        (boneName.endsWith("_l") ? values.leftWristStraighten : values.rightWristStraighten) ?? values.wristStraighten;
      applyAngleReduction(track, rule.wrist, degrees);
    }
    if (rule.swayAxis && isMoving && values.bodySwayScale !== 1) {
      applyTwistScale(track, computeMeanRotation(track), rule.swayAxis, values.bodySwayScale);
    }
    if (rule.twistAxis && isMoving && values.bodyTwistScale !== 1) {
      applyTwistScale(track, computeMeanRotation(track), rule.twistAxis, values.bodyTwistScale);
    }
    if (rule.rollAxis && isMoving && values.walkArmRoll) {
      const roll = new THREE.Quaternion().setFromAxisAngle(
        rule.rollAxis,
        THREE.MathUtils.degToRad(values.walkArmRoll * (rule.rollSign ?? 0)),
      );
      for (let i = 0; i < track.values.length; i += 4) {
        q.fromArray(track.values, i).multiply(roll);
        q.toArray(track.values, i);
      }
    }
    let applied = rule.rotation ?? null;
    if (isMoving && rule.moveRotation)
      applied = applied ? applied.clone().premultiply(rule.moveRotation) : rule.moveRotation;
    if (!applied) return;
    for (let i = 0; i < track.values.length; i += 4) {
      q.fromArray(track.values, i).premultiply(applied);
      q.toArray(track.values, i);
    }
  });
  return clip;
}

/**
 * DEV 덧값 — 주소의 `?walk=`·`?fold=`·`?idle=` 값 `열쇠:값,열쇠:값` 을 객체로.
 *   보기) gait.html?fold=leftElbowStraighten:-20,armForward:-10
 * 열쇠는 CorrectionValues 이름 그대로라 새 보정이 늘어도 고칠 데가 없다.
 */
export function readCorrectionOverrides(param: "walk" | "fold" | "idle"): Record<string, number> | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search).get(param);
  if (!query) return null;
  const out: Record<string, number> = {};
  query.split(",").forEach((pair) => {
    const [key, value] = pair.split(":");
    const number = Number(value);
    if (key && Number.isFinite(number)) out[key.trim()] = number;
  });
  return Object.keys(out).length ? out : null;
}
