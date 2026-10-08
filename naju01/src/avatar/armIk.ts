// 팔 2본 IK — 게임이 준 손 목표로 위팔·아래팔을 돌리고, 손목을 물건 방향에 맞춘다.
// 팔 IK 는 폴 방식과 부호 시험 방식 두 벌이 있다.
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";
import type { ArmPole, AvatarLink, WorldPoint } from "@/engine/avatarLink";

import { chestHalfDepth } from "./fistCenter";
import type { Arm, PreparedBody, Side } from "./preparedBody";
import { rotateInWorld } from "./rig";

// 팔꿈치 폴 기본값 — 꺼진 채. 게임이 armPole 을 내려 주면 그 값이 이긴다.
const DEFAULT_ARM_POLE: ArmPole = { enabled: false, back: 1, down: 1, outward: 0.35, weight: 1 };

/** `__game.armIK` — IK 가 정말 도는지, 무엇에 막혔는지 숫자로 본다 */
interface ArmIkDebug {
  weight?: number;
  leftWeight?: number;
  hasTarget?: boolean;
  leftHasTarget?: boolean;
  armCount?: number;
  torsoHalfDepth?: number | null;
  handRotationWeight?: number | null;
  hasHandRotation?: boolean;
  hasSocket?: boolean;
  mode?: string;
  shoulder?: number[];
  target?: number[];
  hand?: number[];
  remainingDistance?: number;
  shoulderToTarget?: number;
  armLength?: number;
  elbow?: number[];
}
const armIkDebug: ArmIkDebug = {};

export type ArmRequests = Record<Side, { weight: number; target: WorldPoint | null | undefined }>;

// 팔 IK 그릇 — 매 프레임 새로 만들면 GC 끊김이 보인다.
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _W2 = new THREE.Vector3();
const _T = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _parentQ = new THREE.Quaternion();
const _worldQ = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _fixedPole = new THREE.Vector3();
const _elbowGoal = new THREE.Vector3();
const _wristGoal = new THREE.Vector3();
const _bodyV = new THREE.Vector3();
const _bodyScale = new THREE.Vector3();

const roundedPoint = (p: THREE.Vector3) => [p.x, p.y, p.z].map((v) => +v.toFixed(2));

// 뼈를 관절 기준으로 돌려 current 점이 goal 점을 향하게 한다.
function aimBone(bone: THREE.Bone, current: THREE.Vector3, goal: THREE.Vector3, joint: THREE.Vector3) {
  _u.copy(current).sub(joint);
  _v.copy(goal).sub(joint);
  if (_u.lengthSq() < 1e-10 || _v.lengthSq() < 1e-10) return;
  _worldQ.setFromUnitVectors(_u.normalize(), _v.normalize());
  rotateInWorld(bone, _worldQ, _parentQ);
}

function writeDebug(arms: Arm[], side: Side, upperLength: number | null, lowerLength: number) {
  if (side !== "r") return;
  // 배열·문자열을 프레임마다 만드는 값이라 개발 중에만 적는다.
  if (!import.meta.env.DEV) return;
  const rightArm = arms.find((a) => a.side === "r");
  if (rightArm) _W2.setFromMatrixPosition(rightArm.hand.matrixWorld);
  armIkDebug.shoulder = roundedPoint(_S);
  armIkDebug.target = roundedPoint(_T);
  armIkDebug.hand = roundedPoint(_W2);
  armIkDebug.remainingDistance = +_W2.distanceTo(_T).toFixed(3);
  armIkDebug.shoulderToTarget = +_S.distanceTo(_T).toFixed(3);
  if (upperLength != null) armIkDebug.armLength = +(upperLength + lowerLength).toFixed(3);
}

// 폴 방식: 팔 평면을 먼저 정하고 한 번에 푼다. 2본 IK 해는 어깨–손 축을 도는 원뿔 전체라, 굽혀 놓고
// 부호를 사후에 뒤집으면 팔꿈치가 몸 옆 경계를 스칠 때 딸깍거린다(Unity TwoBoneIK Hint · UE Two Bone IK).
function solveWithPole(
  arms: Arm[],
  { side, upper, lower, hand }: Arm,
  weight: number,
  target: WorldPoint,
  pole: ArmPole,
  group: THREE.Object3D,
) {
  _S.setFromMatrixPosition(upper.matrixWorld);
  _E.setFromMatrixPosition(lower.matrixWorld);
  _W.setFromMatrixPosition(hand.matrixWorld);
  const L1 = _S.distanceTo(_E);
  const L2 = _E.distanceTo(_W);
  if (L1 < 1e-5 || L2 < 1e-5) return;
  // 가중치만큼만 당긴다 — 0 이면 클립 자세, 1 이면 목표에 딱.
  _T.set(target.x, target.y, target.z).sub(_W).multiplyScalar(weight).add(_W);
  _axis.copy(_T).sub(_S);
  if (_axis.lengthSq() < 1e-10) return;
  const d = THREE.MathUtils.clamp(_axis.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  _axis.normalize();
  // ① 지금(클립) 팔꿈치 쪽 — 어깨→목표 축에 수직인 성분만.
  _pole.copy(_E).sub(_S);
  _pole.addScaledVector(_axis, -_pole.dot(_axis));
  // ② 몸에 고정된 폴 쪽(뒤·아래·바깥). 모델 로컬 +x 가 왼쪽, +z 가 앞이다. 방향만 쓰므로 거리는 안 맞춘다.
  if (pole.enabled) {
    _fixedPole.set((side === "l" ? 1 : -1) * pole.outward, -pole.down, -pole.back).applyQuaternion(group.quaternion);
    _fixedPole.addScaledVector(_axis, -_fixedPole.dot(_axis));
    // 클립 쪽 → 고정 쪽으로 섞는다. 곧장 못 박으면 물건을 드는 순간 팔꿈치가 홱 돈다.
    const mix = THREE.MathUtils.clamp(pole.weight * weight, 0, 1);
    if (_fixedPole.lengthSq() > 1e-8) {
      _fixedPole.normalize();
      if (_pole.lengthSq() < 1e-8) _pole.copy(_fixedPole);
      else
        _pole
          .normalize()
          .multiplyScalar(1 - mix)
          .addScaledVector(_fixedPole, mix);
    }
  }
  // 축과 폴이 겹쳤다(팔이 곧게 펴짐) — 이번 프레임은 안 건드린다. 아무 평면이나 고르면 딸깍이 다시 생긴다.
  if (_pole.lengthSq() < 1e-8) return;
  _pole.normalize();
  // ③ 팔꿈치 자리 — 코사인 법칙을 각이 아니라 자리로 푼다.
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _elbowGoal.copy(_S).addScaledVector(_axis, a).addScaledVector(_pole, h);
  _wristGoal.copy(_S).addScaledVector(_axis, d);
  // ④ 뼈 둘을 그 자리에 한 번씩 맞춘다. 길이가 그대로라 정확히 겹친다.
  aimBone(upper, _E, _elbowGoal, _S);
  _E.setFromMatrixPosition(lower.matrixWorld);
  _W.setFromMatrixPosition(hand.matrixWorld);
  aimBone(lower, _W, _wristGoal, _E);
  if (side === "r") {
    writeDebug(arms, side, L1, L2);
    if (import.meta.env.DEV) armIkDebug.elbow = roundedPoint(_elbowGoal);
  }
}

// 부호 시험 방식(폴 없음) — 폴이 꺼져 있을 때의 기본. 오른팔은 이 방식으로 화면을 보며 맞춰 두었다.
// 굽혀 본 뒤 팔꿈치가 몸 뒤로 빠지면 반대로 굽힌다.
function solveLegacy(
  arms: Arm[],
  { side, upper, lower, hand }: Arm,
  weight: number,
  target: WorldPoint,
  group: THREE.Object3D,
) {
  _S.setFromMatrixPosition(upper.matrixWorld);
  _W.setFromMatrixPosition(hand.matrixWorld);
  _T.set(target.x, target.y, target.z).sub(_W).multiplyScalar(weight).add(_W);
  let L1 = 0;
  let L2 = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    _S.setFromMatrixPosition(upper.matrixWorld);
    _E.setFromMatrixPosition(lower.matrixWorld);
    _W.setFromMatrixPosition(hand.matrixWorld);
    L1 = _S.distanceTo(_E);
    L2 = _E.distanceTo(_W);
    if (L1 < 1e-5 || L2 < 1e-5) break;
    const d = THREE.MathUtils.clamp(_S.distanceTo(_T), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    // 코사인 법칙 — 팔꿈치 안쪽 각
    const goalAngle = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    _u.copy(_S).sub(_E).normalize();
    _v.copy(_W).sub(_E).normalize();
    const currentAngle = Math.acos(THREE.MathUtils.clamp(_u.dot(_v), -1, 1));
    _n.crossVectors(_u, _v);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0).applyQuaternion(group.quaternion);
    _n.normalize();
    const rotateArm = (bone: THREE.Bone, axis: THREE.Vector3, angle: number) => {
      _worldQ.setFromAxisAngle(axis, angle);
      rotateInWorld(bone, _worldQ, _parentQ);
    };
    // 팔꿈치가 몸 뒤로 빠졌나 — 어깨·손 중점에서 팔꿈치로 가는 벡터의 −z 성분
    const elbowBehind = () => {
      _E.setFromMatrixPosition(lower.matrixWorld);
      _W2.setFromMatrixPosition(hand.matrixWorld);
      _u.copy(_E).sub(_v.copy(_S).add(_W2).multiplyScalar(0.5));
      _v.set(0, 0, -1).applyQuaternion(group.quaternion);
      return _u.dot(_v);
    };
    rotateArm(lower, _n, goalAngle - currentAngle);
    _W2.setFromMatrixPosition(hand.matrixWorld);
    if (Math.abs(_S.distanceTo(_W2) - d) > 1e-3 || elbowBehind() < 0) {
      rotateArm(lower, _n, -2 * (goalAngle - currentAngle));
      _W2.setFromMatrixPosition(hand.matrixWorld);
      if (Math.abs(_S.distanceTo(_W2) - d) > 1e-3 && elbowBehind() < 0) {
        // 어느 쪽도 아니면 원래대로
        rotateArm(lower, _n, goalAngle - currentAngle);
        _W2.setFromMatrixPosition(hand.matrixWorld);
      }
    }
    // 어깨 — 손이 목표를 향하도록 팔 전체를 돌린다
    _u.copy(_W2).sub(_S).normalize();
    _v.copy(_T).sub(_S).normalize();
    _worldQ.setFromUnitVectors(_u, _v);
    rotateInWorld(upper, _worldQ, _parentQ);
  }
  writeDebug(arms, side, L1, L2);
}

/**
 * 팔 IK 한 프레임. 몸 변환을 맞춘 뒤에 불러야 한다 — 그 전이면 지난 프레임 몸 자리 기준이라 걸을 때
 * 한 프레임씩 어긋난다. 각이 아니라 '손이 갈 자리'를 받는다(이 리그는 축이 달라 각을 찍으면 팔이 엉뚱하게 뻗는다).
 * 팔꿈치는 몸 뒤·아래로 빠져야 한다 — 거리만 맞추면 새 날개처럼 위로 꺾인다.
 */
export function solveArms(prepared: PreparedBody, state: AvatarLink, group: THREE.Object3D): ArmRequests {
  const armRequests: ArmRequests = {
    r: { weight: Math.max(0, Math.min(1, state.handIk ?? 0)), target: state.handTarget },
    l: { weight: Math.max(0, Math.min(1, state.leftHandIk ?? 0)), target: state.leftHandTarget },
  };
  // 폴은 화면을 봐야 맞출 수 있어 게임이 상자로 내려 준다. 없으면 꺼짐.
  const pole = state.armPole ?? DEFAULT_ARM_POLE;
  const debug = armIkDebug;
  if (typeof window !== "undefined") exposeDevHook("armIK", debug);
  debug.weight = armRequests.r.weight;
  debug.leftWeight = armRequests.l.weight;
  debug.hasTarget = !!armRequests.r.target;
  debug.leftHasTarget = !!armRequests.l.target;
  debug.armCount = prepared.arms.length;
  // 물건을 안 들어도 보여야 해서 IK 분기 밖에 둔다.
  debug.torsoHalfDepth = state.torsoHalfDepth ?? null;
  debug.handRotationWeight = state.handRotationWeight ?? null;
  debug.hasHandRotation = !!state.handRotation;
  debug.hasSocket = !!state.rightGripSocket;
  debug.mode = pole.enabled ? "폴벡터" : "옛(부호시험)";

  group.updateMatrixWorld(true);

  // 어깨 자리·팔 길이는 IK 를 걸든 안 걸든 알린다 — 첫 프레임부터 게임이 어림값 없이 목표를 잡는다.
  // 품에 안는 자리가 두 어깨의 한가운데라 왼어깨도 낸다.
  prepared.arms.forEach(({ side, upper, lower, hand }) => {
    _S.setFromMatrixPosition(upper.matrixWorld);
    _E.setFromMatrixPosition(lower.matrixWorld);
    _W.setFromMatrixPosition(hand.matrixWorld);
    if (side === "r") {
      state.shoulderPosition = { x: _S.x, y: _S.y, z: _S.z };
      state.shoulderHeight = _S.y;
      state.armLength = _S.distanceTo(_E) + _E.distanceTo(_W);
      // 가슴 두께 — 게임이 든 물건을 몸에서 얼마나 띄울지. 모델 좌표로 재서 세계 배율을 곱한다.
      if (state.torsoHalfDepth === undefined) {
        const skin = prepared.targetSkin;
        const rightUpper = prepared.arms.find((a) => a.side === "r")?.upper;
        if (skin && rightUpper) {
          _bodyV.setFromMatrixPosition(rightUpper.matrixWorld);
          prepared.model.worldToLocal(_bodyV);
          const depth = chestHalfDepth(skin, _bodyV.y, _bodyV.z);
          state.torsoHalfDepth = depth == null ? null : depth * (prepared.model.getWorldScale(_bodyScale).x || 1);
        } else state.torsoHalfDepth = null;
      }
    } else {
      state.leftShoulderPosition = { x: _S.x, y: _S.y, z: _S.z };
    }
  });

  // 왼팔은 게임이 왼손목표를 줄 때만 돈다 — 안 주면 클립 그대로다.
  prepared.arms.forEach((arm) => {
    const { weight, target } = armRequests[arm.side];
    if (!(weight > 0.001) || !target) return;
    if (pole.enabled) solveWithPole(prepared.arms, arm, weight, target, pole, group);
    else solveLegacy(prepared.arms, arm, weight, target, group);
  });
  return armRequests;
}

// 손목 맞춤 — 2본 IK 는 자리만 풀어 손등 방향은 클립 그대로다(UE Effector Rotation 과 같은 것).
// "손등이 어디를 봐야 하나"는 물건 쪽 사실이라 게임이 완성된 세계 회전을 준다.
// 손목이 클립 자세에서 벗어날 수 있는 최대 각(도). 아래팔 기준이 아니다 — hand bind 가 이미 90° 꺾여 있다.
//   사람 손목 실용 가동범위(굽힘·젖힘 40°, Ryu et al. 1991). 축을 나누지 않아 실용값 쪽에 둔다.
const WRIST_LIMIT = 40;

const _handQ = new THREE.Quaternion();
const _handParentQ = new THREE.Quaternion();
const _lowerArmQ = new THREE.Quaternion();
const _restQ = new THREE.Quaternion();
const _goalQ = new THREE.Quaternion();

function alignWrist(arm: Arm, target: { x: number; y: number; z: number; w: number }, strength: number) {
  const { hand } = arm;
  if (!hand || !(strength > 0.001) || !target) return;
  // 기준은 지금 클립이 만든 손 자세다 — hand_r bind 가 X −90° 라 아래팔 기준으로 자르면 매 프레임 손이 끌려간다.
  _restQ.copy(hand.getWorldQuaternion(_lowerArmQ));
  // 목표는 다른 그릇에 담는다 — three 의 slerpQuaternions 가 this === qb 면 목표를 먼저 덮어쓴다.
  _goalQ.set(target.x, target.y, target.z, target.w);
  // 세기만큼만 간 뒤 한계로 자른다(rotateTowards 는 목표를 넘지 않는다)
  _handQ.copy(_restQ).slerp(_goalQ, Math.min(1, strength));
  _restQ.rotateTowards(_handQ, (WRIST_LIMIT * Math.PI) / 180);
  hand.parent?.getWorldQuaternion(_handParentQ);
  hand.quaternion.copy(_handParentQ.invert().multiply(_restQ));
  hand.updateMatrixWorld(true);
}

/** 팔 IK 뒤에 부른다. 그 팔에 IK 가 걸려 있을 때만 돌린다. */
export function alignWrists(arms: Arm[], state: AvatarLink, armRequests: ArmRequests) {
  const wristStrength = Math.max(0, Math.min(1, state.handRotationWeight ?? 0));
  if (!(wristStrength > 0.001)) return;
  const rightArm = arms.find((a) => a.side === "r");
  const leftArm = arms.find((a) => a.side === "l");
  if (rightArm && state.handRotation && armRequests.r.weight > 0.001)
    alignWrist(rightArm, state.handRotation, wristStrength);
  if (leftArm && state.leftHandRotation && armRequests.l.weight > 0.001)
    alignWrist(leftArm, state.leftHandRotation, wristStrength);
}
