// 긴 머리 찰랑임 — 아바타마다 머리 끝의 출렁임 하나를 용수철로 굴린다(정점 계산 없음, 프레임당 산수 몇십 번).
// 머리 뼈의 세계 위치에서 가속도를, 몸 방향(facing)에서 도는 가속도를 얻어 「머리끝이 뒤처지는 정도」를 구하고,
// 셰이더(toonMaterial.ts 의 VERTEX_HAIR_SWAY)가 두피 아래로 내려갈수록 크게 머리칼을 그만큼 민다.
// 원격 플레이어도 위치만 있으면 같은 길로 흔들린다 — 네트워크 보간의 계단에 흔들리지 않게 속도를 먼저 걸러 낸다.
import * as THREE from "three";

/** 고유 진동수(rad/s) — 1.5 Hz 남짓. 머리끝이 한두 번 출렁이고 멎는다 */
const OMEGA = 2 * Math.PI * 1.5;
/** 감쇠비 — 작을수록 오래 찰랑인다 */
const DAMPING = 0.22;
/** 가속도가 머리끝을 미는 세기(1 = 진자 그대로) — 걷기 시작·멈춤에 머리끝이 3~5 cm 밀린다 */
const GAIN = 0.6;
/** 위아래(걸음 들썩임)는 덜 받는다 */
const VERTICAL_GAIN = 0.25;
/** 도는 가속도가 머리를 비트는 세기 */
const TWIST_GAIN = 0.8;
/** 머리끝이 밀리는 한계(m, 아바타 1배 기준)와 비틀림 한계(rad) */
const MAX_OFFSET = 0.05;
const MAX_TWIST = 0.15;
/** 가속도 상한(m/s²) — 순간이동·프레임 튐을 자른다 */
const MAX_ACCEL = 14;
const MAX_YAW_ACCEL = 40;
/** 한 프레임에 이보다 멀리 가면(m) 순간이동으로 보고 출렁임을 지운다 */
const TELEPORT = 0.6;

export interface HairSway {
  /** 머리끝 밀림(아바타 로컬 축, m) — 셰이더 _swayOffset */
  offset: THREE.Vector3;
  /** 척추 축을 중심으로 머리칼이 비틀린 각(rad) — 셰이더 _swayTwist */
  twist: number;
  velocity: THREE.Vector3;
  twistVelocity: number;
  lastHead: THREE.Vector3;
  smoothVelocity: THREE.Vector3;
  lastSmoothVelocity: THREE.Vector3;
  lastFacing: number;
  yawRate: number;
  started: boolean;
}

export function createHairSway(): HairSway {
  return {
    offset: new THREE.Vector3(),
    twist: 0,
    velocity: new THREE.Vector3(),
    twistVelocity: 0,
    lastHead: new THREE.Vector3(),
    smoothVelocity: new THREE.Vector3(),
    lastSmoothVelocity: new THREE.Vector3(),
    lastFacing: 0,
    yawRate: 0,
    started: false,
  };
}

/** 출렁임을 지운다(순간이동·다시 나타남) */
export function resetHairSway(sway: HairSway) {
  sway.offset.set(0, 0, 0);
  sway.velocity.set(0, 0, 0);
  sway.twist = 0;
  sway.twistVelocity = 0;
  sway.smoothVelocity.set(0, 0, 0);
  sway.lastSmoothVelocity.set(0, 0, 0);
  sway.yawRate = 0;
  sway.started = false;
}

const _raw = new THREE.Vector3();
const _accel = new THREE.Vector3();

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * 한 프레임 굴린다. headWorld = head 뼈 세계 위치, facing = 몸 방향(앞 = (sin f, cos f)), scale = 아바타 배율(세계 단위 / m).
 * offset 은 아바타 로컬 축(+X = 오른쪽, +Z = 앞) 의 m 단위라 메시 로컬에 그대로 더하면 된다.
 */
export function stepHairSway(sway: HairSway, headWorld: THREE.Vector3, facing: number, scale: number, delta: number) {
  if (!(delta > 0) || !(scale > 0)) return;
  if (!sway.started) {
    sway.lastHead.copy(headWorld);
    sway.lastFacing = facing;
    sway.started = true;
    return;
  }
  _raw.copy(headWorld).sub(sway.lastHead).divideScalar(scale);
  sway.lastHead.copy(headWorld);
  if (_raw.length() > TELEPORT) {
    resetHairSway(sway);
    sway.lastHead.copy(headWorld);
    sway.lastFacing = facing;
    sway.started = true;
    return;
  }
  // 미분은 실제로 흐른 시간(delta)으로 한다 — 프레임이 멈췄다 오면 그동안 간 거리가 한 번에 오는데, 잘라 낸 시간으로
  // 나누면 속도가 부풀어 머리가 휙 튄다. 속도를 먼저 걸러 낸다 — 날것의 차분은 네트워크 보간의 계단을 그대로 키운다.
  _raw.divideScalar(delta);
  const blend = 1 - Math.exp(-delta * 14);
  sway.lastSmoothVelocity.copy(sway.smoothVelocity);
  sway.smoothVelocity.lerp(_raw, blend);
  _accel.copy(sway.smoothVelocity).sub(sway.lastSmoothVelocity).divideScalar(delta);
  if (_accel.length() > MAX_ACCEL) _accel.setLength(MAX_ACCEL);
  // 세계 축 → 아바타 로컬 축(+Z 앞, +X 오른쪽)
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  const ax = _accel.x * cos - _accel.z * sin;
  const az = _accel.x * sin + _accel.z * cos;
  const ay = _accel.y;
  // 돌 때 — 몸이 돌기 시작하면 머리칼이 반대로 뒤처지고, 멈추면 넘어간다
  const yawRate = wrapAngle(facing - sway.lastFacing) / delta;
  sway.lastFacing = facing;
  const smoothYawRate = sway.yawRate + (yawRate - sway.yawRate) * blend;
  const yawAccel = THREE.MathUtils.clamp((smoothYawRate - sway.yawRate) / delta, -MAX_YAW_ACCEL, MAX_YAW_ACCEL);
  sway.yawRate = smoothYawRate;
  // 용수철: o'' = −ω²o − 2ζωo' − 가속도. 반암시적 오일러, 1/60초 이하로 쪼개 굴린다(오래 멈췄던 프레임은 0.1초까지만).
  const k = OMEGA * OMEGA;
  const c = 2 * DAMPING * OMEGA;
  const o = sway.offset;
  const v = sway.velocity;
  const total = Math.min(delta, 0.1);
  const steps = Math.ceil(total * 60);
  const dt = total / steps;
  for (let step = 0; step < steps; step++) {
    v.x += (-k * o.x - c * v.x - GAIN * ax) * dt;
    v.y += (-k * o.y - c * v.y - VERTICAL_GAIN * ay) * dt;
    v.z += (-k * o.z - c * v.z - GAIN * az) * dt;
    o.addScaledVector(v, dt);
    sway.twistVelocity += (-k * sway.twist - c * sway.twistVelocity - TWIST_GAIN * yawAccel) * dt;
    sway.twist += sway.twistVelocity * dt;
  }
  if (o.length() > MAX_OFFSET) {
    o.setLength(MAX_OFFSET);
    v.multiplyScalar(0.5);
  }
  if (Math.abs(sway.twist) > MAX_TWIST) {
    sway.twist = Math.sign(sway.twist) * MAX_TWIST;
    sway.twistVelocity *= 0.5;
  }
}
