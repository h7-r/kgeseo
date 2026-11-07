// 절차 손짓 — 클립 파일 없이 그 성별 대기 위에 몇 개 뼈만 덮어쓴다(2026-11-07 미르: 「안녕은 손바닥을 보이고 흔들어야」,
// 미안해·고마워·알았어에 어울리는 동작 — 검토 16회차). 후보 9개 중 미르가 고른 넷만 남겼다(안녕 ③ · 미안해 ① · 고마워 ② ·
// 알았어 ①, 나머지는 폐기). 보는 화면: gesture-gallery.html(개발 전용).
//
// 좌표: 아바타 무리(group) 공간 — +x 왼쪽 · +y 위 · +z 앞(armIk.ts 와 같은 규약, 11/7 뼈 좌표로 다시 잼).
// 축 이름을 외워 각도를 넣지 않는다 — 위팔·아래팔은 「가리킬 방향」을 주고, 그 프레임의 실제 뼈 위치로 지금 방향 → 목표 방향
// 회전을 구해 부모 공간으로 옮긴다(캐릭터 자세 측정법 메모의 교훈). 손바닥은 아래팔을 제 축으로 비틀어 맞춘다.
// 이 몸(meshy-base)은 손가락·비틀림 뼈에 스킨 가중치가 없어 손가락 모양(엄지 척·OK)은 못 만든다 — 손은 펴기만(주먹 모프 0).
// 적용 순서(ChibiGameAvatar): 믹서·체형 → 손짓 → 팔 IK(물건 들기가 이긴다) → 손목 맞춤 → 접지.
import * as THREE from "three";

import type { Arm, PreparedBody, Side } from "./preparedBody";
import { exposeDevHook } from "@/debug/devHooks";

import { applyWorldRotation } from "./rig";

type Dir = readonly [number, number, number];

export interface ArmPose {
  /** 위팔(어깨→팔꿈치)이 가리킬 방향 — group 공간, 길이는 상관없다 */
  upper?: Dir;
  /** 아래팔(팔꿈치→손목)이 가리킬 방향 */
  fore?: Dir;
  /** 손바닥이 볼 방향 */
  palm?: Dir;
  /**
   * 손바닥을 palm 쪽으로 맞추려 손목을 꺾는 최대 각(도). 없으면 아래팔 비틀기만 — 비틀기만으로는 손바닥 면이 몸에 안 붙는다
   * (11/7 미르: 가슴에 손이 떨어져 보인다)
   */
  wristBend?: number;
  /** 손을 몸에 얹는다 — 가슴(심장 쪽) · 배꼽 아래(두 손 모으기). 두 마디 IK, 그 몸의 앞면을 재서 자리를 정한다 */
  reach?: ReachKind;
}

export interface GesturePose {
  r?: ArmPose;
  l?: ArmPose;
  /** 허리 숙임(도, 앞으로 +) — 등뼈 셋에 나눠 굽힌다 */
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
/** 0 → 1 → 0 한 번(구간 [a, b]) */
const bump = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)) ** 2);

export const GESTURES: Readonly<Record<string, GestureDef>> = {
  // 안녕(③) 어깨 높이로 손 들고 가볍게 까딱
  waveSmall: {
    seconds: 1.6,
    fadeIn: 0.25,
    fadeOut: 0.3,
    pose: (t) => ({
      r: {
        upper: [-0.42, -0.72, 0.4],
        fore: swayZ([-0.18, 0.8, 0.55], 14 * Math.sin(TAU * 3 * t)),
        palm: [0, 0.15, 1],
      },
    }),
  },
  // 미안해(①) 고개·허리 살짝 숙이기, 두 손은 배꼽 아래로 공손히 모은다(11/7 미르: 팔을 떨구는 자세가 어색하다)
  sorryBow: {
    seconds: 1.9,
    fadeIn: 0.4,
    fadeOut: 0.45,
    pose: () => ({
      bow: 18,
      nod: 20,
      // 아래 손(왼손)은 손끝 쪽으로 꺾어 배의 둥근 면(옆구리로 넘어가는 면)에, 위 손은 아래 손등에 판판하게
      r: { reach: "belly", palm: [0, 0.2, -1], wristBend: 60 },
      l: { reach: "belly", palm: [0.3, 0.2, -1], wristBend: 60 },
    }),
  },
  // 고마워(②) 가슴에 손 얹고 고개 끄덕
  thanksChest: {
    seconds: 2,
    fadeIn: 0.35,
    fadeOut: 0.4,
    // 손바닥은 몸 쪽 · 가운데 · 아래로 꺾어 가슴 굴곡(옆구리 쪽 · 쇄골 쪽으로 넘어가는 면)에 붙인다(11/7 미르: 손바닥이 떠 있다)
    pose: (t) => ({ r: { reach: "chest", palm: [-0.3, -0.4, -1], wristBend: 75 }, nod: 16 * bump(t, 0.55, 1.45) }),
  },
  // 알았어(①) 고개 두 번 끄덕
  okNod: {
    seconds: 1.3,
    fadeIn: 0.1,
    fadeOut: 0.15,
    pose: (t) => ({ nod: 17 * (bump(t, 0.05, 0.6) + bump(t, 0.6, 1.15)) }),
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
  arms: Map<Side, Arm & { index: THREE.Bone | null; pinky: THREE.Bone | null }>;
  /** 손을 얹을 자리의 기준 뼈(가슴 spine_03 · 배 pelvis) */
  refs: Map<string, THREE.Bone>;
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
  const arms = new Map<Side, Arm & { index: THREE.Bone | null; pinky: THREE.Bone | null }>();
  prepared.arms.forEach((arm) =>
    arms.set(arm.side, { ...arm, index: get(`index_01_${arm.side}`), pinky: get(`pinky_01_${arm.side}`) }),
  );
  const refs = new Map<string, THREE.Bone>();
  for (const spec of Object.values(REACH)) {
    const bone = get(spec.ref);
    if (bone) refs.set(spec.ref, bone);
  }
  const all = [
    ...spine.map((s) => s.bone),
    ...nod.map((s) => s.bone),
    ...[...arms.values()].flatMap((arm) => [arm.upper, arm.lower, arm.hand]),
  ];
  const result = { spine, nod, arms, refs, all };
  bonesCache.set(prepared, result);
  return result;
}

export interface GestureState {
  /** 덮어쓴 뼈의 클립 자세 — 믹서가 같은 값이라 안 쓴 프레임에 덮어쓴 값이 쌓이지 않게(접지 IK 와 같은 방어) */
  store: Map<THREE.Bone, { clip: THREE.Quaternion; mine: THREE.Quaternion | null }>;
  weight: number;
  /** 마지막으로 튼 손짓 — 끊기면 이 자세에서 짧게 풀어 돌아온다 */
  last: ActiveGesture | null;
  /** 손을 얹을 자리 — 손짓을 시작할 때 한 번 잰다(settleContacts). 열쇠는 「얹을 곳:쪽」 */
  contacts: Map<string, Contact>;
}

export const createGestureState = (): GestureState => ({
  store: new Map(),
  weight: 0,
  last: null,
  contacts: new Map(),
});

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
function palmNormal(
  arm: { side: Side; hand: THREE.Bone; index: THREE.Bone | null; pinky: THREE.Bone | null },
  out: THREE.Vector3,
) {
  if (!arm.index || !arm.pinky) return null;
  worldPos(arm.hand, _c);
  worldPos(arm.index, _a).sub(_c);
  worldPos(arm.pinky, _b).sub(_c);
  out.crossVectors(_a, _b);
  if (arm.side === "l") out.negate();
  return out.lengthSq() > 1e-12 ? out.normalize() : null;
}

/** 아래팔을 제 축으로 비틀어 손바닥이 palm 쪽을 보게 */
function turnPalm(arm: GestureArm, palm: THREE.Vector3, w: number) {
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

/**
 * 손을 몸에 얹는 자리 — 기준 뼈에서 옆(side: 반대쪽으로 +) · 위(up) · 앞(잰 앞면 + palm), 팔꿈치 폴(group 방향: 바깥 · 위 · 앞).
 * palm 은 처음 놓아 보는 거리일 뿐 — 손짓을 시작할 때 다 얹은 자세를 한 번 몰래 만들어 손바닥과 몸의 실제 틈을 재고
 * clearance 만 남게 앞뒤로 옮긴다(settleContacts). 손뼈가 손바닥 면에서 떨어진 거리가 남 2.8cm · 여 1.3cm 로 달라
 * 고정 거리로는 한쪽이 뜬다(11/7). approach 는 얹으러 올 때·내릴 때 손이 앞쪽에서 들어오게 더하는 거리(무게가
 * 0 일수록 많이) — 몸을 뚫고 지나가지 않게. layer 는 두 손을 포갤 때 위에 오는 손(아래 손 등에 붙인다)과, 그걸 못 쟀을 때
 * 띄울 거리. 단위는 모델 단위(group 안쪽). 값은 손짓 고르기 화면(gesture-gallery.html)에서 잰 것.
 */
export interface ReachSpec {
  ref: string;
  /** 앞면을 잴 살이 묶인 뼈(합 0.6 이상 — 가슴 위쪽 · 아랫배는 여러 뼈에 나눠 묶여 0.9 로는 빈다) */
  surface: readonly string[];
  side: number;
  up: number;
  palm: number;
  /** 손바닥과 몸 사이에 남길 틈 */
  clearance: number;
  /** 못 쟀을 때 쓰는 앞 거리(기준 뼈에서) */
  forward: number;
  approach: number;
  pole: [number, number, number];
  layer?: { side: Side; extra: number };
}
export interface Contact {
  /** 몸 앞면(기준 뼈에서 앞쪽 거리) — null 은 못 잼 */
  front: number | null;
  /** 실제 틈에 맞춰 손목을 몸 쪽으로 옮길 거리 */
  shift: number;
}
export type ReachKind = "chest" | "belly";
export const REACH: Record<ReachKind, ReachSpec> = {
  // 가슴(심장 쪽)에 손 — 높이 0.06(여자는 가슴 아래로 들어가 묻혔다) → 0.13(손끝이 쇄골 쪽 비탈 위로 떠 손이 서 보였다)
  // → 0.10. 팔꿈치는 바깥·앞(뒤로 빼면 아래팔이 가슴을 비스듬히 가로질러 파고든다). 여자 가슴은 쇄골에도 나눠 묶여 쇄골까지 본다(11/7)
  chest: {
    ref: "spine_03",
    surface: ["spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r", "neck_01"],
    side: 0.03,
    up: 0.1,
    palm: 0.04,
    clearance: 0.002,
    forward: 0.15,
    approach: 0.12,
    pole: [0.9, -0.45, 0.6],
  },
  // 배꼽 아래에 두 손을 모은다(미안해) — 두 손이 가운데서 만나고 오른손이 위로 포갠다. 팔꿈치는 바깥 · 조금 앞(옆구리로
  // 붙이면 숙일 때 여자는 배가 아래팔 위로 나와 4cm 묻혔다)
  belly: {
    ref: "pelvis",
    surface: ["pelvis", "spine_01", "spine_02", "spine_03"],
    side: -0.012,
    up: 0.08,
    palm: 0.035,
    clearance: 0.002,
    forward: 0.12,
    approach: 0.08,
    pole: [0.7, -0.45, 0.55],
    layer: { side: "r", extra: 0.04 },
  },
};
/** 개발 확인용 — 마지막으로 잰 자리(열쇠 「얹을 곳:쪽」) */
const REACH_DEBUG: Record<string, Contact & { gap: number | null }> = {};
if (import.meta.env.DEV) exposeDevHook("gestureTuning", Object.assign(REACH, { debug: REACH_DEBUG }));

const _inverseGroup = new THREE.Matrix4();
const _vertex = new THREE.Vector3();

/** 앞면을 잴 정점 번호(몸·얹을 곳마다 한 번) — 5만 정점의 가중치를 손짓마다 다시 훑지 않게 */
const surfaceCache = new WeakMap<PreparedBody, Map<ReachKind, number[]>>();
function surfaceVertices(prepared: PreparedBody, kind: ReachKind): number[] {
  let byKind = surfaceCache.get(prepared);
  if (!byKind) surfaceCache.set(prepared, (byKind = new Map()));
  const cached = byKind.get(kind);
  if (cached) return cached;
  const skin = prepared.targetSkin;
  const bones = skin.skeleton.bones;
  const names = new Set(REACH[kind].surface);
  const index = skin.geometry.getAttribute("skinIndex");
  const weight = skin.geometry.getAttribute("skinWeight");
  const list: number[] = [];
  if (index && weight)
    for (let i = 0; i < index.count; i += 1) {
      let sum = 0;
      for (let k = 0; k < index.itemSize; k += 1) {
        const name = bones[index.getComponent(i, k)]?.name;
        if (name !== undefined && names.has(name)) sum += weight.getComponent(i, k);
      }
      if (sum >= 0.6) list.push(i);
    }
  byKind.set(kind, list);
  return list;
}

/** 한 뼈에 0.9 이상 묶인 정점 번호(손 · 아래팔) — 이 몸은 손가락 뼈에 가중치가 없어 손가락도 손뼈에 묶였다 */
const boneVertexCache = new WeakMap<PreparedBody, Map<string, number[]>>();
function boneVertices(prepared: PreparedBody, boneName: string): number[] {
  let byBone = boneVertexCache.get(prepared);
  if (!byBone) boneVertexCache.set(prepared, (byBone = new Map()));
  const cached = byBone.get(boneName);
  if (cached) return cached;
  const skin = prepared.targetSkin;
  const bones = skin.skeleton.bones;
  const index = skin.geometry.getAttribute("skinIndex");
  const weight = skin.geometry.getAttribute("skinWeight");
  const list: number[] = [];
  if (index && weight)
    for (let i = 0; i < index.count; i += 1) {
      let sum = 0;
      for (let k = 0; k < index.itemSize; k += 1)
        if (bones[index.getComponent(i, k)]?.name === boneName) sum += weight.getComponent(i, k);
      if (sum >= 0.9) list.push(i);
    }
  byBone.set(boneName, list);
  return list;
}

/** 정점들의 지금 자리(group 안쪽 단위) — group 의 역행렬이 배율까지 지운다(배율로 또 나누면 안 된다, Codex 리뷰) */
function skinnedPoints(prepared: PreparedBody, list: number[]) {
  const skin = prepared.targetSkin;
  const out = new Float32Array(list.length * 3);
  list.forEach((vertex, n) => {
    skin.getVertexPosition(vertex, _vertex);
    _vertex.applyMatrix4(skin.matrixWorld).applyMatrix4(_inverseGroup);
    out[n * 3] = _vertex.x;
    out[n * 3 + 1] = _vertex.y;
    out[n * 3 + 2] = _vertex.z;
  });
  return out;
}

/** 앞에서 본 칸(1.2cm)마다 가장 앞(또는 뒤)의 z */
const CELL = 0.012;
const cellOf = (x: number, y: number) => (Math.round(x / CELL) + 1000) * 4096 + Math.round(y / CELL) + 1000;
function addToGrid(grid: Map<number, number>, points: Float32Array) {
  for (let n = 0; n < points.length; n += 3) {
    const key = cellOf(points[n], points[n + 1]);
    grid.set(key, Math.max(grid.get(key) ?? -Infinity, points[n + 2]));
  }
}

/**
 * 몸 앞면 — 손을 얹을 자리(기준 뼈 + 옆·위) 둘레 ±3cm 안의 표면 정점 중 가장 앞의 z 를, 기준 뼈 z 를 뺀 거리로(모델 단위).
 * 체형(통통·골격·남녀)마다 달라 고정값이면 남자는 아래팔이 묻히고 여자는 손이 뜬다(11/7).
 */
function frontOf(surface: Float32Array, base: THREE.Vector3, kind: ReachKind, sign: number) {
  const spec = REACH[kind];
  const tx = base.x - sign * spec.side;
  const ty = base.y + spec.up;
  let front = -Infinity;
  for (let n = 0; n < surface.length; n += 3)
    if (Math.abs(surface[n] - tx) <= 0.03 && Math.abs(surface[n + 1] - ty) <= 0.03)
      front = Math.max(front, surface[n + 2]);
  return Number.isFinite(front) ? front - base.z : null;
}

/** 손바닥 쪽 틈 — 칸마다 손의 가장 뒤(몸 쪽) z 와 그 칸의 몸(또는 아래 손 등) 앞면의 차, 그중 아래 10% 값 */
function palmGap(hand: Float32Array, grid: Map<number, number>) {
  const nearest = new Map<number, number>();
  for (let n = 0; n < hand.length; n += 3) {
    const key = cellOf(hand[n], hand[n + 1]);
    nearest.set(key, Math.min(nearest.get(key) ?? Infinity, hand[n + 2]));
  }
  const gaps: number[] = [];
  nearest.forEach((z, key) => {
    const surface = grid.get(key);
    if (surface !== undefined) gaps.push(z - surface);
  });
  if (gaps.length < 3) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length * 0.1)];
}

/** 아래팔이 앞면 안으로 들어간 깊이 — 칸마다 앞면 − 정점 z(0 ~ 8cm 만, 더 깊으면 몸 뒤), 다섯째로 깊은 값 */
function sinkDepth(points: Float32Array, grid: Map<number, number>) {
  const depths: number[] = [];
  for (let n = 0; n < points.length; n += 3) {
    const surface = grid.get(cellOf(points[n], points[n + 1]));
    if (surface === undefined) continue;
    const depth = surface - points[n + 2];
    if (depth > 0 && depth < 0.08) depths.push(depth);
  }
  depths.sort((a, b) => b - a);
  return depths[4] ?? 0;
}
/** 아래팔이 몸에 이만큼까지 들어가는 건 둔다(살 · 옷 두께 안) */
const FOREARM_TOLERANCE = 0.004;

/** 손목을 몸 앞 자리에 — 두 마디 IK(armIk 의 폴 방식과 같은 풀이) */
function reachBody(
  arm: Arm,
  ref: THREE.Bone,
  group: THREE.Object3D,
  w: number,
  kind: ReachKind,
  contact: Contact | undefined,
) {
  const spec = REACH[kind];
  const scale = group.getWorldScale(_a).x || 1;
  const sign = arm.side === "l" ? 1 : -1;
  const layer = spec.layer?.side === arm.side ? spec.layer.extra : 0;
  const front = contact?.front ?? null;
  // 기준 뼈 앞 — 옆·위, 앞은 잰 앞면 + 손바닥 거리(+ 포갠 손) − 실제 틈. 모델 단위 × 배율(group 회전만 곱한다)
  _wrist
    .set(
      -sign * spec.side,
      spec.up,
      (front === null ? spec.forward : front + spec.palm) + layer - (contact?.shift ?? 0) + spec.approach * (1 - w),
    )
    .multiplyScalar(scale)
    .applyQuaternion(_groupQ)
    .add(worldPos(ref, _b));
  const S = worldPos(arm.upper, _a.clone());
  const E = worldPos(arm.lower, _b.clone());
  const W = worldPos(arm.hand, _c.clone());
  const L1 = S.distanceTo(E);
  const L2 = E.distanceTo(W);
  // 다 얹은 자세를 풀고, 그 회전을 무게만큼만 건다 — 목표만 섞고 팔꿈치는 다 돌리면 무게가 0 에 가까워도
  // 팔꿈치가 8~12cm 튄다(Codex 리뷰)
  const axis = _wrist.clone().sub(S);
  const d = THREE.MathUtils.clamp(axis.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  axis.normalize();
  toWorld([sign * spec.pole[0], spec.pole[1], spec.pole[2]], _pole);
  _pole.addScaledVector(axis, -_pole.dot(axis));
  if (_pole.lengthSq() < 1e-8) return;
  _pole.normalize();
  const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
  _elbow.copy(S).addScaledVector(axis, along).addScaledVector(_pole, h);
  const wristGoal = S.clone().addScaledVector(axis, d);
  aim(arm.upper, arm.lower, _elbow.clone().sub(S).normalize(), w);
  aim(arm.lower, arm.hand, wristGoal.sub(worldPos(arm.lower, _b)).normalize(), w);
}

type GestureArm = Arm & { index: THREE.Bone | null; pinky: THREE.Bone | null };

/** 팔 하나 — 몸에 얹기(또는 방향 맞추기) → 손바닥 돌리기 → 손목 꺾기 */
function poseArm(
  arm: GestureArm,
  target: ArmPose,
  ref: THREE.Bone | undefined,
  group: THREE.Object3D,
  w: number,
  contact?: Contact,
) {
  if (target.reach && ref) reachBody(arm, ref, group, w, target.reach, contact);
  else {
    if (target.upper) aim(arm.upper, arm.lower, toWorld(target.upper, new THREE.Vector3()), w);
    if (target.fore) aim(arm.lower, arm.hand, toWorld(target.fore, new THREE.Vector3()), w);
  }
  if (target.palm) {
    const palm = toWorld(target.palm, new THREE.Vector3());
    turnPalm(arm, palm, w);
    if (target.wristBend) bendWrist(arm, palm, target.wristBend, w);
  }
}

/** 허리·고개 — group 의 옆 축(+x) 둘레로 앞으로 숙인다 */
function bendTorso(bones: GestureBones, pose: GesturePose, w: number) {
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
}

/**
 * 손바닥 붙이기 — 손짓을 시작할 때 한 번. 다 얹은 자세(무게 1 · 숙이기 포함 · 주먹 모프 0)를 몰래 만들어 몸 앞면과
 * 손바닥과 몸의 실제 틈을 잰 뒤 clearance 만 남게 손목 자리를 옮긴다(숙이기를 빼고 재면 숙일 때 몸이 손 · 팔을 덮친다). 포개는 손은 아래 손을 먼저 놓고 그 등에 붙인다. 뼈 · 모프는 되돌린다.
 * 정점을 훑으니 시작 프레임에만(체형마다 다른 몸에 맞추려고 — 고정 거리로는 남자는 붙고 여자는 떴다, 11/7).
 */
function settleContacts(
  gs: GestureState,
  prepared: PreparedBody,
  group: THREE.Object3D,
  bones: GestureBones,
  pose: GesturePose,
) {
  _inverseGroup.copy(group.matrixWorld).invert();
  const sides = (["r", "l"] as const).filter((side) => {
    const kind = pose[side]?.reach;
    return kind && bones.arms.get(side) && bones.refs.get(REACH[kind].ref);
  });
  // 위에 포갤 손은 나중에
  const onTop = (side: Side) => REACH[pose[side]!.reach!].layer?.side === side;
  sides.sort((a, b) => Number(onTop(a)) - Number(onTop(b)));
  const saved = bones.all.map((bone) => [bone, bone.quaternion.clone()] as const);
  bendTorso(bones, pose, 1);
  const restoreArm = (side: Side) => {
    const arm = bones.arms.get(side)!;
    for (const [bone, q] of saved)
      if (bone === arm.upper || bone === arm.lower || bone === arm.hand) bone.quaternion.copy(q);
    arm.upper.updateMatrixWorld(true);
  };
  const fists = prepared.fistMorphs.flatMap(({ mesh, index }) =>
    mesh.morphTargetInfluences
      ? [{ list: mesh.morphTargetInfluences, index, value: mesh.morphTargetInfluences[index] }]
      : [],
  );
  fists.forEach(({ list, index }) => (list[index] = 0));
  // body 는 몸 앞면, stack 은 몸 + 먼저 놓은 손등(위 손바닥이 붙을 면). 아래팔은 몸에만 견준다 — 포갠 손은 아래 손가락이
  // 위 손목 밑으로 들어가는 게 맞다(아래 손까지 견주면 여자는 위 손이 3~4cm 떴다)
  const surfaces = new Map<
    ReachKind,
    { points: Float32Array; body: Map<number, number>; stack: Map<number, number> }
  >();
  for (const side of sides) {
    const target = pose[side]!;
    const kind = target.reach!;
    const arm = bones.arms.get(side)!;
    const ref = bones.refs.get(REACH[kind].ref)!;
    let surface = surfaces.get(kind);
    if (!surface) {
      const points = skinnedPoints(prepared, surfaceVertices(prepared, kind));
      const body = new Map<number, number>();
      addToGrid(body, points);
      surfaces.set(kind, (surface = { points, body, stack: new Map(body) }));
    }
    const base = worldPos(ref, _d).applyMatrix4(_inverseGroup);
    const contact: Contact = { front: frontOf(surface.points, base, kind, side === "l" ? 1 : -1), shift: 0 };
    poseArm(arm, target, ref, group, 1, contact);
    const hand = boneVertices(prepared, `hand_${side}`);
    const gap = palmGap(skinnedPoints(prepared, hand), surface.stack);
    if (gap !== null) contact.shift = THREE.MathUtils.clamp(gap - REACH[kind].clearance, -0.04, 0.06);
    // 아래팔이 몸에 묻히면 손목을 그만큼 앞으로(손바닥이 조금 뜨는 쪽이 낫다) — 숙이면 배·가슴이 팔 위로 나온다
    const forearm = boneVertices(prepared, `lowerarm_${side}`);
    for (let round = 0; ; round += 1) {
      restoreArm(side);
      poseArm(arm, target, ref, group, 1, contact);
      const depth = sinkDepth(skinnedPoints(prepared, forearm), surface.body);
      if (depth <= FOREARM_TOLERANCE || round === 3) break;
      contact.shift -= depth - FOREARM_TOLERANCE;
    }
    // 포갤 손이 남았으면 이 손등을 앞면에 더한다(위 손은 그 위에 놓는다)
    if (sides.some((other) => other !== side && onTop(other) && pose[other]!.reach === kind))
      addToGrid(surface.stack, skinnedPoints(prepared, hand));
    gs.contacts.set(`${kind}:${side}`, contact);
    if (import.meta.env.DEV) REACH_DEBUG[`${kind}:${side}`] = { ...contact, gap };
    restoreArm(side);
  }
  fists.forEach(({ list, index, value }) => (list[index] = value));
  for (const [bone, q] of saved) bone.quaternion.copy(q);
  group.updateMatrixWorld(true);
}

/** 손목을 꺾어 손바닥 면이 palm 쪽을 보게(최대 limit 도) — 아래팔 비틀기 뒤에 남은 각만 */
function bendWrist(arm: GestureArm, palm: THREE.Vector3, limit: number, w: number) {
  const normal = palmNormal(arm, _d);
  if (!normal) return;
  _full.setFromUnitVectors(normal, palm);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(_full.w, -1, 1));
  const share = angle > 1e-6 ? Math.min(1, deg(limit) / angle) : 1;
  _q.slerpQuaternions(_identity, _full, share * w);
  applyWorldRotation(arm.hand, _q, _pq);
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
    // 새 손짓을 시작하면 몸 앞면을 다시 잰다(아래에서 뼈를 클립 자세로 되돌린 뒤)
    if (!gs.last || gs.last.name !== active.name || active.elapsed < gs.last.elapsed) gs.contacts.clear();
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
  // 손을 몸에 얹는 손짓 — 시작할 때 한 번, 한가운데 자세(숙이기 · 끄덕 포함)로 손바닥 자리를 맞춘다
  if ((["r", "l"] as const).some((side) => pose[side]?.reach && !gs.contacts.has(`${pose[side]!.reach}:${side}`)))
    settleContacts(gs, prepared, group, bones, def.pose(def.seconds / 2));
  bendTorso(bones, pose, w);
  // 팔 — 위팔 → 아래팔 → 손바닥 차례(앞 뼈가 움직인 자리에서 다음 뼈를 잰다)
  for (const sideName of ["r", "l"] as const) {
    const target = pose[sideName];
    const arm = bones.arms.get(sideName);
    if (!target || !arm) continue;
    const ref = target.reach ? bones.refs.get(REACH[target.reach].ref) : undefined;
    poseArm(arm, target, ref, group, w, target.reach ? gs.contacts.get(`${target.reach}:${sideName}`) : undefined);
  }
  for (const bone of bones.all) {
    const entry = gs.store.get(bone);
    if (entry) entry.mine = (entry.mine ?? new THREE.Quaternion()).copy(bone.quaternion);
  }
  return w;
}
