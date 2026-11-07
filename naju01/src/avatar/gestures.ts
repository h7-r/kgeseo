// 절차 손짓 — 클립 파일 없이 그 성별 대기 위에 몇 개 뼈만 덮어쓴다(2026-11-07 미르: 「안녕은 손바닥을 보이고 흔들어야」,
// 미안해·고마워·알았어에 어울리는 동작 후보 — 검토 16회차). 고르는 화면: gesture-gallery.html(개발 전용).
//
// 좌표: 아바타 무리(group) 공간 — +x 왼쪽 · +y 위 · +z 앞(armIk.ts 와 같은 규약, 11/7 뼈 좌표로 다시 잼).
// 축 이름을 외워 각도를 넣지 않는다 — 위팔·아래팔은 「가리킬 방향」을 주고, 그 프레임의 실제 뼈 위치로 지금 방향 → 목표 방향
// 회전을 구해 부모 공간으로 옮긴다(캐릭터 자세 측정법 메모의 교훈). 손바닥은 아래팔을 제 축으로 비틀어 맞춘다.
// 이 몸(meshy-base)은 손가락·비틀림 뼈에 스킨 가중치가 없어 손가락 모양(엄지 척·OK)은 못 만든다 — 손은 펴기만(주먹 모프 0).
// 적용 순서(ChibiGameAvatar): 믹서·체형 → 손짓 → 팔 IK(물건 들기가 이긴다) → 손목 맞춤 → 접지.
import * as THREE from "three";

import type { Arm, PreparedBody, Side } from "./preparedBody";
import { applyWorldRotation } from "./rig";

type Dir = readonly [number, number, number];

export interface ArmPose {
  /** 위팔(어깨→팔꿈치)이 가리킬 방향 — group 공간, 길이는 상관없다 */
  upper?: Dir;
  /** 아래팔(팔꿈치→손목)이 가리킬 방향 */
  fore?: Dir;
  /** 손바닥이 볼 방향 */
  palm?: Dir;
  /** 손을 가슴에 얹는다(두 마디 IK — 팔꿈치는 아래·바깥) */
  onChest?: boolean;
}

export interface GesturePose {
  r?: ArmPose;
  l?: ArmPose;
  /** 허리 숙임(도, 앞으로 +) */
  bow?: number;
  /** 고개 숙임(도, 앞으로 +) */
  nod?: number;
}

export interface GestureDef {
  /** 전체 길이(초) — 인사 단계 길이와 같게 쓴다 */
  seconds: number;
  fadeIn: number;
  fadeOut: number;
  /** t = 시작부터 흐른 초 */
  pose: (t: number) => GesturePose;
}

/** 지금 트는 손짓(useMotionPlayer 가 실제로 고른 인사 단계에서만 채운다) */
export interface ActiveGesture {
  name: string;
  elapsed: number;
}

const deg = THREE.MathUtils.degToRad;
const TAU = Math.PI * 2;
/** group 공간 방향을 앞 축(+z) 둘레로 a 도 돌린다 — 흔들기 */
const swayZ = ([x, y, z]: Dir, a: number): Dir => {
  const c = Math.cos(deg(a));
  const s = Math.sin(deg(a));
  return [x * c - y * s, x * s + y * c, z];
};
/** 오른팔 방향을 왼팔로(좌우 뒤집기) */
const mirror = ([x, y, z]: Dir): Dir => [-x, y, z];
/** 0 → 1 → 0 한 번(구간 [a, b]) */
const bump = (t: number, a: number, b: number) =>
  t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)) ** 2;

/** 차렷처럼 팔을 몸 옆에 내림(허리에 손 대기 자세를 덮는다) */
const ARM_DOWN_R: ArmPose = { upper: [-0.16, -1, 0.04], fore: [-0.06, -1, 0.12] };
const ARM_DOWN_L: ArmPose = { upper: mirror(ARM_DOWN_R.upper!), fore: mirror(ARM_DOWN_R.fore!) };
/** 두 손을 배 앞으로 모으는 쪽(닿지는 않게) */
const HANDS_FRONT_R: ArmPose = { upper: [-0.08, -1, 0.24], fore: [0.3, -0.75, 0.5] };
const HANDS_FRONT_L: ArmPose = { upper: mirror(HANDS_FRONT_R.upper!), fore: mirror(HANDS_FRONT_R.fore!) };

export const GESTURES: Readonly<Record<string, GestureDef>> = {
  // 안녕 ① 머리 옆에서 아래팔 흔들기 — 손바닥 앞
  waveSide: {
    seconds: 1.9,
    fadeIn: 0.3,
    fadeOut: 0.35,
    pose: (t) => ({ r: { upper: [-0.62, 0.5, 0.2], fore: swayZ([-0.1, 1, 0.12], 24 * Math.sin(TAU * 2.2 * t)), palm: [0, 0, 1] } }),
  },
  // 안녕 ② 머리 위로 팔 전체를 크게
  waveBig: {
    seconds: 2,
    fadeIn: 0.3,
    fadeOut: 0.35,
    pose: (t) => ({
      r: {
        upper: swayZ([-0.32, 1, 0.08], 12 * Math.sin(TAU * 1.6 * t)),
        fore: swayZ([-0.06, 1, 0.06], 30 * Math.sin(TAU * 1.6 * t + 0.6)),
        palm: [0, 0, 1],
      },
    }),
  },
  // 안녕 ③ 어깨 높이로 손 들고 가볍게 까딱
  waveSmall: {
    seconds: 1.6,
    fadeIn: 0.25,
    fadeOut: 0.3,
    pose: (t) => ({
      r: { upper: [-0.42, -0.72, 0.4], fore: swayZ([-0.18, 0.8, 0.55], 14 * Math.sin(TAU * 3 * t)), palm: [0, 0.15, 1] },
    }),
  },
  // 미안해 ① 고개·허리 살짝 숙이기, 팔은 내림
  sorryBow: {
    seconds: 1.9,
    fadeIn: 0.4,
    fadeOut: 0.45,
    pose: () => ({ bow: 18, nod: 20, r: ARM_DOWN_R, l: ARM_DOWN_L }),
  },
  // 미안해 ② 두 손을 앞에 모으고 깊이 꾸벅
  sorryDeep: {
    seconds: 2.1,
    fadeIn: 0.45,
    fadeOut: 0.5,
    pose: () => ({ bow: 36, nod: 14, r: HANDS_FRONT_R, l: HANDS_FRONT_L }),
  },
  // 고마워 ① 가볍게 꾸벅(빠르게 숙였다 올라옴)
  thanksBow: {
    seconds: 1.4,
    fadeIn: 0.25,
    fadeOut: 0.5,
    pose: () => ({ bow: 28, nod: 10, r: ARM_DOWN_R, l: ARM_DOWN_L }),
  },
  // 고마워 ② 가슴에 손 얹고 고개 끄덕
  thanksChest: {
    seconds: 2,
    fadeIn: 0.35,
    fadeOut: 0.4,
    pose: (t) => ({ r: { onChest: true, palm: [0, 0, -1] }, nod: 16 * bump(t, 0.55, 1.45) }),
  },
  // 알았어 ① 고개 두 번 끄덕
  okNod: {
    seconds: 1.3,
    fadeIn: 0.1,
    fadeOut: 0.15,
    pose: (t) => ({ nod: 17 * (bump(t, 0.05, 0.6) + bump(t, 0.6, 1.15)) }),
  },
  // 알았어 ② 손 들어 「응」(손바닥 보이며) + 한 번 끄덕
  okHand: {
    seconds: 1.5,
    fadeIn: 0.25,
    fadeOut: 0.35,
    pose: (t) => ({ r: { upper: [-0.45, -0.5, 0.38], fore: [-0.08, 0.92, 0.35], palm: [0, 0.1, 1] }, nod: 12 * bump(t, 0.35, 1) }),
  },
};

/** 앞뒤 섞기 무게 0~1 */
function envelope(def: GestureDef, t: number) {
  const rise = THREE.MathUtils.smoothstep(t, 0, def.fadeIn);
  const fall = 1 - THREE.MathUtils.smoothstep(t, def.seconds - def.fadeOut, def.seconds);
  return Math.min(rise, fall);
}

interface GestureBones {
  spine: { bone: THREE.Bone; share: number }[];
  nod: { bone: THREE.Bone; share: number }[];
  arms: Map<Side, Arm & { index: THREE.Bone | null; pinky: THREE.Bone | null; chestRef: THREE.Bone | null }>;
  all: THREE.Bone[];
}
const bonesCache = new WeakMap<PreparedBody, GestureBones>();
function bonesOf(prepared: PreparedBody): GestureBones {
  const cached = bonesCache.get(prepared);
  if (cached) return cached;
  const get = (name: string) => prepared.targetSkin.skeleton.getBoneByName(name) ?? null;
  const pairs = (list: [string, number][]) =>
    list.flatMap(([name, share]) => {
      const bone = get(name);
      return bone ? [{ bone, share }] : [];
    });
  const spine = pairs([
    ["spine_01", 0.35],
    ["spine_02", 0.35],
    ["spine_03", 0.3],
  ]);
  const nod = pairs([
    ["neck_01", 0.35],
    ["head", 0.65],
  ]);
  const arms = new Map<Side, Arm & { index: THREE.Bone | null; pinky: THREE.Bone | null; chestRef: THREE.Bone | null }>();
  prepared.arms.forEach((arm) =>
    arms.set(arm.side, {
      ...arm,
      index: get(`index_01_${arm.side}`),
      pinky: get(`pinky_01_${arm.side}`),
      chestRef: get("spine_03"),
    }),
  );
  const all = [
    ...spine.map((s) => s.bone),
    ...nod.map((s) => s.bone),
    ...[...arms.values()].flatMap((arm) => [arm.upper, arm.lower, arm.hand]),
  ];
  const result = { spine, nod, arms, all };
  bonesCache.set(prepared, result);
  return result;
}

export interface GestureState {
  /** 덮어쓴 뼈의 클립 자세 — 믹서가 같은 값이라 안 쓴 프레임에 덮어쓴 값이 쌓이지 않게(접지 IK 와 같은 방어) */
  store: Map<THREE.Bone, { clip: THREE.Quaternion; mine: THREE.Quaternion | null }>;
  weight: number;
  /** 마지막으로 튼 손짓 — 끊기면 이 자세에서 짧게 풀어 돌아온다 */
  last: ActiveGesture | null;
}

export const createGestureState = (): GestureState => ({ store: new Map(), weight: 0, last: null });

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _full = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _groupQ = new THREE.Quaternion();
const _identity = new THREE.Quaternion();
const _elbow = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _pole = new THREE.Vector3();
/** 끊긴 손짓이 풀리는 시정수(초) */
const RELEASE_SECONDS = 0.09;

const toWorld = (dir: Dir, out: THREE.Vector3) => out.set(dir[0], dir[1], dir[2]).applyQuaternion(_groupQ).normalize();
const worldPos = (bone: THREE.Object3D, out: THREE.Vector3) => out.setFromMatrixPosition(bone.matrixWorld);

/** bone(→child)이 세계 방향 dir 을 가리키게 w 만큼 돌린다 */
function aim(bone: THREE.Bone, child: THREE.Object3D, dir: THREE.Vector3, w: number) {
  worldPos(child, _a).sub(worldPos(bone, _b));
  if (_a.lengthSq() < 1e-12) return;
  // 받는 쪽과 넣는 쪽을 같은 객체로 쓰면 안 된다 — slerpQuaternions 는 먼저 시작값을 복사해 넣는 값까지 지운다
  _full.setFromUnitVectors(_a.normalize(), dir);
  _q.slerpQuaternions(_identity, _full, w);
  applyWorldRotation(bone, _q, _pq);
}

/** 손바닥 법선(세계) — 오른손은 (검지 뿌리 − 손목) × (새끼 뿌리 − 손목), 왼손은 반대(11/7 허리에 손 자세로 잼: 오른 손바닥이 몸 쪽) */
function palmNormal(arm: { side: Side; hand: THREE.Bone; index: THREE.Bone | null; pinky: THREE.Bone | null }, out: THREE.Vector3) {
  if (!arm.index || !arm.pinky) return null;
  worldPos(arm.hand, _c);
  worldPos(arm.index, _a).sub(_c);
  worldPos(arm.pinky, _b).sub(_c);
  out.crossVectors(_a, _b);
  if (arm.side === "l") out.negate();
  return out.lengthSq() > 1e-12 ? out.normalize() : null;
}

/** 아래팔을 제 축으로 비틀어 손바닥이 palm 쪽을 보게 */
function turnPalm(arm: Arm & { index: THREE.Bone | null; pinky: THREE.Bone | null }, palm: THREE.Vector3, w: number) {
  const normal = palmNormal(arm, _d);
  if (!normal) return;
  worldPos(arm.hand, _axis).sub(worldPos(arm.lower, _a)).normalize();
  const n = _b.copy(normal).addScaledVector(_axis, -normal.dot(_axis));
  const p = _c.copy(palm).addScaledVector(_axis, -palm.dot(_axis));
  if (n.lengthSq() < 1e-8 || p.lengthSq() < 1e-8) return;
  n.normalize();
  p.normalize();
  const angle = Math.atan2(_a.crossVectors(n, p).dot(_axis), n.dot(p));
  _q.setFromAxisAngle(_axis, angle * w);
  applyWorldRotation(arm.lower, _q, _pq);
}

/** 손목을 가슴 앞에 — 두 마디 IK(armIk 의 폴 방식과 같은 풀이), 팔꿈치는 아래·바깥·조금 뒤 */
function reachChest(arm: Arm & { chestRef: THREE.Bone | null }, group: THREE.Object3D, w: number) {
  if (!arm.chestRef) return;
  const scale = group.getWorldScale(_a).x || 1;
  const sign = arm.side === "l" ? 1 : -1;
  // 가슴뼈 앞 — 반대쪽으로 조금(심장 쪽), 위로 조금. 모델 단위 × 배율
  toWorld([-sign * 0.04, 0.06, 0.13], _wrist)
    .multiplyScalar(scale * (_d.set(-sign * 0.04, 0.06, 0.13).length()))
    .add(worldPos(arm.chestRef, _b));
  const S = worldPos(arm.upper, _a.clone());
  const E = worldPos(arm.lower, _b.clone());
  const W = worldPos(arm.hand, _c.clone());
  const L1 = S.distanceTo(E);
  const L2 = E.distanceTo(W);
  const goal = _wrist.clone().sub(W).multiplyScalar(w).add(W);
  const axis = goal.clone().sub(S);
  const d = THREE.MathUtils.clamp(axis.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  axis.normalize();
  toWorld([sign * 0.7, -0.6, -0.25], _pole);
  _pole.addScaledVector(axis, -_pole.dot(axis));
  if (_pole.lengthSq() < 1e-8) return;
  _pole.normalize();
  const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
  _elbow.copy(S).addScaledVector(axis, along).addScaledVector(_pole, h);
  const wristGoal = S.clone().addScaledVector(axis, d);
  aim(arm.upper, arm.lower, _elbow.clone().sub(S).normalize(), 1);
  aim(arm.lower, arm.hand, wristGoal.sub(worldPos(arm.lower, _b)).normalize(), 1);
}

/**
 * 이번 프레임 손짓을 덮어쓴다. group.updateMatrixWorld 뒤, 팔 IK 앞에 부른다. 돌려준 무게(0~1)로 주먹 쥐기를 푼다.
 */
export function applyGesture(
  gs: GestureState,
  prepared: PreparedBody,
  group: THREE.Object3D,
  active: ActiveGesture | null,
  delta: number,
): number {
  const def = active ? GESTURES[active.name] : gs.last ? GESTURES[gs.last.name] : undefined;
  if (active && def) {
    gs.last = { ...active };
    gs.weight = envelope(def, active.elapsed);
  } else if (gs.last) {
    // 끊겼다(움직임·맞기 등) — 지금 자세에서 짧게 풀어 돌아온다
    gs.weight *= Math.exp(-Math.max(0, delta) / RELEASE_SECONDS);
  }
  const bones = bonesOf(prepared);
  // 믹서가 이번 프레임에 안 쓴 뼈는 지난번 덮어쓴 값이 남아 있다 — 클립 자세로 되돌리고 시작한다
  for (const bone of bones.all) {
    let entry = gs.store.get(bone);
    if (!entry) {
      if (gs.weight <= 0.001) continue;
      entry = { clip: bone.quaternion.clone(), mine: null };
      gs.store.set(bone, entry);
    } else if (entry.mine && bone.quaternion.equals(entry.mine)) bone.quaternion.copy(entry.clip);
    else entry.clip.copy(bone.quaternion);
  }
  if (!def || gs.weight <= 0.001) {
    gs.weight = 0;
    gs.last = null;
    gs.store.clear();
    group.updateMatrixWorld(true);
    return 0;
  }
  group.updateMatrixWorld(true);
  group.getWorldQuaternion(_groupQ);
  const w = gs.weight;
  const pose = def.pose((active ?? gs.last)!.elapsed);
  // 허리·고개 — group 의 옆 축(+x) 둘레로 앞으로 숙인다
  const side = toWorld([1, 0, 0], new THREE.Vector3());
  for (const [list, angle] of [
    [bones.spine, pose.bow ?? 0],
    [bones.nod, pose.nod ?? 0],
  ] as const) {
    if (!angle) continue;
    for (const { bone, share } of list) {
      _q.setFromAxisAngle(side, deg(angle) * share * w);
      applyWorldRotation(bone, _q, _pq);
    }
  }
  // 팔 — 위팔 → 아래팔 → 손바닥 차례(앞 뼈가 움직인 자리에서 다음 뼈를 잰다)
  for (const sideName of ["r", "l"] as const) {
    const target = pose[sideName];
    const arm = bones.arms.get(sideName);
    if (!target || !arm) continue;
    if (target.onChest) reachChest(arm, group, w);
    else {
      if (target.upper) aim(arm.upper, arm.lower, toWorld(target.upper, new THREE.Vector3()), w);
      if (target.fore) aim(arm.lower, arm.hand, toWorld(target.fore, new THREE.Vector3()), w);
    }
    if (target.palm) turnPalm(arm, toWorld(target.palm, new THREE.Vector3()), w);
  }
  for (const bone of bones.all) {
    const entry = gs.store.get(bone);
    if (entry) entry.mine = (entry.mine ?? new THREE.Quaternion()).copy(bone.quaternion);
  }
  return w;
}
