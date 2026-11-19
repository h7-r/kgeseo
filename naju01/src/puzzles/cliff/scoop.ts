/**
 * 물 뜨는 손짓 — 사발 · 귀때동이가 손에서 독으로 가, 기울어 물에 잠겼다가, 물을 담고 바로 서서 손으로 돌아온다.
 * 흙에 묻힌 귀때동이를 뽑아 드는 손짓도 여기서 한다. 소지품은 E 를 누른 순간 바뀌고, 이것은 그 사이를 눈에 보여 줄 뿐이다.
 * 좌표는 유닛. 그릇은 손에 든 크기(HAND_SCALE)로 그린다.
 */
import * as THREE from "three";

import { makeGlowPoints, pointScaleFor } from "../glowPoints";
import { HAND_SCALE, handItemAt } from "../handPlace";
import { M } from "../units";
import { makeWaterRipple, setRippleAge } from "../waterRipple";

/** 한 번 뜨는 데 걸리는 시간(초) · 뽑아 드는 데 걸리는 시간(초) */
const SCOOP_SECONDS = 1.45;
const PULL_SECONDS = 0.8;
/**
 * 뜨는 차례(0~1) — 독 위에 닿는 때 · 물에 다 잠긴 때 · 물 위로 올라온 때. 그 뒤는 손으로 돌아온다
 */
const BEATS = { above: 0.3, under: 0.5, lifted: 0.72 };
/** 독 물낯 위로 넘어가는 높이(미터) · 물에 잠기는 깊이(그릇 높이의 배) · 기울이는 각(라디안) */
const CLEAR = 0.17;
const SINK = 0.55;
const TILT = 1.15;
const DRIPS = 14;
/** 잠기는 순간 튀어 오르는 물방울 수 · 튀는 시간(초) */
const SPLASH = { drops: 12, seconds: 0.55 };
/** 물결이 다 번지는 데 걸리는 시간(초) */
const RIPPLE_SECONDS = 1.5;

type Motion =
  | {
      kind: "scoop";
      key: string;
      time: number;
      waterAt: THREE.Vector3;
      /** 물낯 반지름(미터) — 물결이 이만큼 번진다 */
      waterRadius: number;
      onDip: () => void;
      isDipped: boolean;
    }
  | { kind: "pull"; key: string; time: number; from: THREE.Vector3; tilt: THREE.Euler };

export function buildScoop() {
  const root = new THREE.Group();
  root.name = "cliff.scoop";
  const prop = new THREE.Group();
  prop.visible = false;
  // 물결 — 그릇이 잠긴 자리에서 잔물결이 번진다. 손짓이 끝난 뒤에도 마저 스러진다
  const ripple = makeWaterRipple();
  // 물방울 — 앞쪽은 그릇 밑에서 떨어지는 것, 뒤쪽은 잠기는 순간 튀는 것
  const drips = makeGlowPoints(DRIPS + SPLASH.drops, { additive: true, softness: 1.4 });
  drips.points.visible = false;
  root.add(prop, ripple.mesh, drips.points);
  return {
    root,
    prop,
    ripple,
    drips,
    /** 그릇 모형 — 이름(물건 종류)마다. height 는 그릇 높이(미터), water 는 담긴 물낯(없으면 null) */
    vessels: new Map<string, { object: THREE.Object3D; height: number; water: THREE.Object3D | null }>(),
    motion: null as Motion | null,
    /** 물에 잠긴 뒤 흐른 시간(초) · 그 자리(유닛) · 물낯 반지름(미터) — 잠긴 적이 없으면 음수 */
    dipped: { since: -1, at: new THREE.Vector3(), radius: 0 },
    seeds: Float32Array.from({ length: (DRIPS + SPLASH.drops) * 3 }, () => Math.random()),
    hand: new THREE.Vector3(),
    at: new THREE.Vector3(),
    side: new THREE.Vector3(),
    toward: new THREE.Vector3(),
    spin: new THREE.Quaternion(),
  };
}

export type Scoop = ReturnType<typeof buildScoop>;

/** 그릇 모형을 건다 — water 는 물을 담았을 때 보일 물낯(그릇 밑이 원점, 미터) */
export function addScoopVessel(scoop: Scoop, key: string, source: THREE.Object3D, water: THREE.Object3D | null = null) {
  const object = new THREE.Group();
  const model = source.clone(true);
  const box = new THREE.Box3().setFromObject(model);
  object.add(model);
  if (water) object.add(water);
  object.visible = false;
  scoop.prop.add(object);
  scoop.vessels.set(key, { object, height: box.max.y - box.min.y, water });
}

/** 독에서 물을 뜬다 — 물에 잠기는 순간 onDip(첨벙 소리 등)을 부른다. 앞 손짓이 덜 끝났으면 그 자리에서 새 그릇으로 바꿔 든다 */
export function startScoop(scoop: Scoop, key: string, water: { at: THREE.Vector3; radius: number }, onDip: () => void) {
  if (!scoop.vessels.has(key)) return onDip();
  scoop.motion = { kind: "scoop", key, time: 0, waterAt: water.at, waterRadius: water.radius, onDip, isDipped: false };
}

/** 흙에서 뽑아 든다 — from 은 묻혀 있던 자리, tilt 는 묻혀 있던 기울기 */
export function startPull(scoop: Scoop, key: string, from: THREE.Vector3, tilt: THREE.Euler) {
  if (!scoop.vessels.has(key)) return;
  scoop.motion = { kind: "pull", key, time: 0, from: from.clone(), tilt: tilt.clone() };
}

const ease = (from: number, to: number, value: number) => THREE.MathUtils.smootherstep(value, from, to);
const UP = new THREE.Vector3(0, 1, 0);

export function updateScoop(scoop: Scoop, dt: number, time: number, gl: THREE.WebGLRenderer, camera: THREE.Camera) {
  const motion = scoop.motion;
  scoop.prop.visible = !!motion;
  updateSplash(scoop, dt, gl, camera);
  if (!motion) return;
  const vessel = scoop.vessels.get(motion.key)!;
  for (const other of scoop.vessels.values()) other.object.visible = other === vessel;
  motion.time += dt;
  const { prop, hand, at, side, toward } = scoop;
  handItemAt(camera, hand);
  prop.scale.setScalar(M * HAND_SCALE);

  if (motion.kind === "pull") {
    const t = Math.min(1, motion.time / PULL_SECONDS);
    // 먼저 위로 쑥 뽑히고, 그다음 손으로 온다. 묻혀 있던 기울기가 풀리며 바로 선다
    const lifted = ease(0, 0.45, t);
    const carried = ease(0.3, 1, t);
    at.copy(motion.from).setY(motion.from.y + lifted * 0.3 * M);
    prop.position.lerpVectors(at, hand, carried);
    prop.rotation.set(motion.tilt.x * (1 - lifted), motion.tilt.y, motion.tilt.z * (1 - lifted));
    prop.scale.setScalar(M * THREE.MathUtils.lerp(1, HAND_SCALE, carried));
    if (vessel.water) vessel.water.visible = false;
    if (t >= 1) scoop.motion = null;
    return;
  }

  const t = Math.min(1, motion.time / SCOOP_SECONDS);
  const { waterAt } = motion;
  const height = vessel.height * HAND_SCALE * M;
  // 손 → 독 위 → 물속 → 독 위 → 손
  const over = at.copy(waterAt).setY(waterAt.y + CLEAR * M);
  if (t < BEATS.above) prop.position.lerpVectors(hand, over, ease(0, BEATS.above, t));
  else if (t < BEATS.lifted) {
    // 잠겼다 올라온다 — 그릇 밑이 물낯 아래로
    const dip = t < BEATS.under ? ease(BEATS.above, BEATS.under, t) : 1 - ease(BEATS.under, BEATS.lifted, t);
    prop.position.copy(over).setY(THREE.MathUtils.lerp(over.y, waterAt.y - height * SINK, dip));
  } else prop.position.lerpVectors(over, hand, ease(BEATS.lifted, 1, t));
  // 기울기 — 독으로 가며 아가리를 물 쪽으로 숙이고, 물속에서 바로 세우며 물을 담는다
  toward.subVectors(waterAt, camera.position).setY(0).normalize();
  side.crossVectors(UP, toward).normalize();
  const tilt = TILT * ease(0.08, BEATS.above + 0.06, t) * (1 - ease(BEATS.under - 0.06, BEATS.under + 0.1, t));
  prop.quaternion.setFromAxisAngle(side, tilt);
  // 그릇 가운데를 축으로 기울게 — 밑이 원점이라 기운 만큼 뒤로 물린다
  prop.position.addScaledVector(toward, -Math.sin(tilt) * height * 0.5);

  const isFull = t >= BEATS.under;
  if (vessel.water) vessel.water.visible = isFull;
  if (isFull && !motion.isDipped) {
    motion.isDipped = true;
    scoop.dipped.since = 0;
    scoop.dipped.at.copy(waterAt);
    scoop.dipped.radius = motion.waterRadius;
    motion.onDip();
  }

  // 물방울 — 올라온 그릇 밑에서 뚝뚝 떨어진다
  const isDripping = t > BEATS.under + 0.08;
  for (let i = 0; i < DRIPS; i++) {
    const fall = (time * (1.6 + scoop.seeds[i * 3]) + scoop.seeds[i * 3 + 1] * 3) % 1;
    const angle = scoop.seeds[i * 3 + 2] * Math.PI * 2;
    const rim = height * 0.35;
    scoop.drips.position.setXYZ(
      i,
      prop.position.x + Math.cos(angle) * rim,
      prop.position.y - fall * fall * 0.3 * M,
      prop.position.z + Math.sin(angle) * rim,
    );
    scoop.drips.size.setX(i, (0.012 + 0.012 * scoop.seeds[i * 3]) * M);
    scoop.drips.alpha.setX(i, isDripping ? 0.9 * (1 - fall) * (1 - ease(0.85, 1, t)) : 0);
    scoop.drips.color.setXYZ(i, 0.62, 0.74, 1.0);
  }
  if (t >= 1) scoop.motion = null;
}

/** 잠긴 자리의 물결과 튀는 물방울 — 그릇이 손으로 돌아간 뒤에도 물낯에서 마저 번지다 스러진다 */
function updateSplash(scoop: Scoop, dt: number, gl: THREE.WebGLRenderer, camera: THREE.Camera) {
  const { dipped, drips, seeds } = scoop;
  if (dipped.since >= 0) dipped.since += dt;
  const age = dipped.since >= 0 ? dipped.since / RIPPLE_SECONDS : -1;
  setRippleAge(scoop.ripple, age);
  if (scoop.ripple.mesh.visible) {
    scoop.ripple.mesh.position.copy(dipped.at).setY(dipped.at.y + 0.004 * M);
    scoop.ripple.mesh.scale.setScalar(dipped.radius * M);
  }
  // 튀는 물방울 — 잠긴 자리에서 솟았다 물낯으로 떨어진다
  const flight = dipped.since >= 0 ? dipped.since / SPLASH.seconds : 1;
  for (let k = 0; k < SPLASH.drops; k++) {
    const i = DRIPS + k;
    const angle = seeds[i * 3] * Math.PI * 2;
    const power = 0.4 + seeds[i * 3 + 1] * 0.6;
    const out = dipped.radius * 0.75 * power * flight;
    drips.position.setXYZ(
      i,
      dipped.at.x + Math.cos(angle) * out * M,
      dipped.at.y + power * 0.5 * flight * (1 - flight) * M,
      dipped.at.z + Math.sin(angle) * out * M,
    );
    drips.size.setX(i, (0.014 + 0.014 * seeds[i * 3 + 2]) * M);
    drips.alpha.setX(i, flight < 1 ? 0.85 * (1 - flight * 0.5) : 0);
    drips.color.setXYZ(i, 0.8, 0.88, 1.0);
  }
  drips.points.visible = !!scoop.motion || flight < 1;
  if (!drips.points.visible) return;
  // 손짓이 끝났으면 떨어지던 물방울은 지운다
  if (!scoop.motion) for (let i = 0; i < DRIPS; i++) drips.alpha.setX(i, 0);
  drips.commit();
  drips.material.uniforms.uPointScale.value = pointScaleFor(gl, camera);
}
