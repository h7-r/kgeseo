/**
 * 건져 올린 통발 안의 불씨 — 통발과 함께 맴돌다, 화톳불에 쏟으면 하나씩 재로 떨어져 불티를 튀긴다.
 * 마지막 한 마리는 나머지를 다 부은 뒤 따로 앞에 털어 낸다 — 뭍에서 파닥이며 소지품에 챙길 수 있다.
 */
import * as THREE from "three";

import { audio } from "../../scene/immersion/audio";
import { makeGlowPoints, type GlowPoints } from "../glowPoints";
import { showNotice } from "../interaction";
import { inventory } from "../inventory";
import { M, groundY } from "../units";
import { FULL_COUNT } from "./fishTrapState";
import { EMBER } from "./lightFish";
import { HEARTH } from "./site";
import type { Trap } from "./trapRig";

/** 들어 옮기고 → 기울여 쏟고 → 내려놓기까지(초) */
export const POUR_SECONDS = 3.6;
/** 쏟은 물고기가 떨어지는 무게 — 실제 중력(9.8)보다 조금 느리게 보이게 */
const FALL_GRAVITY = 6.5;
/** 건져 올린 통발엔 적어도 이만큼 들어 있다 — 화톳불에 부을 게 넉넉해 보이게 */
export const MIN_CATCH = 4;
/** 마지막 한 마리 — 쏟기 진행 중 이때 나와 이만큼(초) 날아간다 */
const LAST_RELEASE = 0.8;
const LAST_FLIGHT = 0.6;
const SPARK_COUNT = 60;
const SPARK_LIFE = 0.7;

const scratch = { direction: new THREE.Vector3(), position: new THREE.Vector3(), away: new THREE.Vector3() };
const FORWARD = new THREE.Vector3(0, 0, 1);
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const matrix = new THREE.Matrix4();

const hearthPoint = () => new THREE.Vector3(HEARTH.x * M, (groundY(HEARTH.x, HEARTH.z) + 0.04) * M, HEARTH.z * M);

/** 쏟고 남은 한 마리가 떨어지는 자리 — 내려놓은 통발 너머, 불에서 먼 쪽 */
function leftoverFishSpot(trap: Trap) {
  const hearth = hearthPoint();
  const away = new THREE.Vector3().subVectors(trap.landPosition, hearth).setY(0).normalize();
  const spot = hearth.addScaledVector(away, 1.35 * M);
  spot.y = groundY(spot.x / M, spot.z / M) * M;
  return spot;
}

/** 쏟는 동안 통발 자세 — 들어 올려 화톳불 위로 → 입구를 재 쪽으로 기울여 멈춤 → 곁에 내려놓기 */
export function poseForPour(trap: Trap, progress: number, startQuaternion: THREE.Quaternion) {
  const hearth = hearthPoint();
  const away = scratch.away.subVectors(trap.landPosition, hearth).setY(0).normalize();
  const above = hearth
    .clone()
    .addScaledVector(away, 0.45 * M)
    .add(new THREE.Vector3(0, 0.85 * M, 0));
  const rest = hearth.clone().addScaledVector(away, 0.8 * M);
  rest.y = groundY(rest.x / M, rest.z / M) * M;
  const tiltDirection = hearth.clone().sub(above).normalize();
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), tiltDirection);
  if (progress < 0.25) {
    const t = THREE.MathUtils.smootherstep(progress / 0.25, 0, 1);
    trap.object.position.lerpVectors(trap.landPosition, above, t);
    trap.object.position.y += Math.sin(t * Math.PI) * 0.2 * M;
    trap.object.quaternion.slerpQuaternions(startQuaternion, tilt, t);
  } else if (progress < 0.72) {
    // 털어 내듯 잘게 흔든다
    trap.object.position.copy(above);
    trap.object.position.x += Math.sin(progress * 90) * 0.012 * M;
    trap.object.quaternion.copy(tilt);
  } else {
    const t = THREE.MathUtils.smootherstep((progress - 0.72) / 0.28, 0, 1);
    trap.object.position.lerpVectors(above, rest, t);
    trap.object.position.y += Math.sin(t * Math.PI) * 0.15 * M;
    trap.object.quaternion.slerpQuaternions(tilt, trap.baseQuaternion, t);
  }
}

/** 쏟는 물고기 하나하나의 떨어짐 — 나온 자리 · 빠르기 · 재에 닿았나 */
export function createPourState() {
  return {
    startQuaternion: new THREE.Quaternion(),
    from: Array.from({ length: FULL_COUNT }, () => new THREE.Vector3()),
    velocity: Array.from({ length: FULL_COUNT }, () => new THREE.Vector3()),
    released: new Uint8Array(FULL_COUNT),
    landed: new Uint8Array(FULL_COUNT),
  };
}
export type PourState = ReturnType<typeof createPourState>;

/** 쏟기를 시작한다 — 지금 자세에서 들어 올린다 */
export function startPour(state: PourState, trap: Trap) {
  state.startQuaternion.copy(trap.object.quaternion);
  state.released.fill(0);
  state.landed.fill(0);
}

/** 재에 닿을 때 튀는 불티 */
export function createSparks() {
  return {
    points: makeGlowPoints(SPARK_COUNT, { additive: true }),
    position: Array.from({ length: SPARK_COUNT }, () => new THREE.Vector3()),
    velocity: Array.from({ length: SPARK_COUNT }, () => new THREE.Vector3()),
    age: new Float32Array(SPARK_COUNT).fill(9),
    next: 0,
  };
}
export type Sparks = ReturnType<typeof createSparks>;

function emitSparks(sparks: Sparks, at: THREE.Vector3, count: number) {
  for (let n = 0; n < count; n++) {
    const k = sparks.next;
    sparks.next = (sparks.next + 1) % SPARK_COUNT;
    sparks.position[k].copy(at);
    const angle = Math.random() * Math.PI * 2;
    const out = 0.3 + Math.random() * 0.5;
    sparks.velocity[k].set(Math.cos(angle) * out, 1 + Math.random() * 1.2, Math.sin(angle) * out).multiplyScalar(M);
    sparks.age[k] = 0;
  }
}

/** 불티 한 프레임 — 위로 튀었다가 식으며 떨어진다 */
export function updateSparks(sparks: Sparks, dt: number) {
  for (let k = 0; k < SPARK_COUNT; k++) {
    sparks.age[k] += dt;
    if (sparks.age[k] > SPARK_LIFE) {
      sparks.points.alpha.setX(k, 0);
      continue;
    }
    sparks.velocity[k].y -= 4 * M * dt;
    sparks.position[k].addScaledVector(sparks.velocity[k], dt);
    const t = sparks.age[k] / SPARK_LIFE;
    const point = sparks.position[k];
    sparks.points.position.setXYZ(k, point.x, point.y, point.z);
    sparks.points.size.setX(k, (0.07 - t * 0.04) * M);
    sparks.points.alpha.setX(k, 1 - t);
    sparks.points.color.setXYZ(k, 2, 0.9 - t * 0.4, 0.3 - t * 0.2);
  }
  sparks.points.commit();
}

interface CarriedEmbers {
  /** 불씨를 실어 나르는 통발(끌려 올라오는 중 · 뭍 · 돌아가는 중). 없으면 null */
  carrier: Trap | null;
  /** 쏟기 진행 0~1. 아직이면 −1 */
  pour: number;
  /** 불이 붙은 뒤 — 통발 안 불씨는 더 그리지 않는다 */
  isHearthLit: boolean;
  pourState: PourState;
  sparks: Sparks;
  caughtFish: THREE.InstancedMesh;
  caughtEmbers: GlowPoints;
  time: number;
}

/**
 * 통발 안 불씨 한 프레임 — 통발 안에서 맴돌다 차례가 오면 입구로 미끄러져 나와 떨어진다.
 * 아직 통발에 남은 수를 돌려준다(둘레를 밝히는 빛 세기에 쓴다)
 */
export function updateCarriedEmbers({
  carrier,
  pour,
  isHearthLit,
  pourState,
  sparks,
  caughtFish,
  caughtEmbers,
  time,
}: CarriedEmbers) {
  const carried = carrier ? Math.min(FULL_COUNT, carrier.caught) : 0;
  const hearth = hearthPoint();
  const hide = (k: number) => {
    caughtEmbers.alpha.setX(k, 0);
    caughtFish.setMatrixAt(k, matrix.makeScale(0, 0, 0));
  };
  let remaining = 0;
  for (let k = 0; k < FULL_COUNT; k++) {
    if (!carrier || k >= carried || isHearthLit || pourState.landed[k]) {
      hide(k);
      continue;
    }
    const isLast = k === carried - 1;
    const releaseAt = isLast ? LAST_RELEASE : 0.27 + (0.4 * k) / Math.max(1, carried - 2);
    const isFalling = pour >= 0 && pour >= releaseAt;
    if (isFalling && !pourState.released[k]) {
      pourState.released[k] = 1;
      scratch.direction.set(0, 0, -1).applyQuaternion(carrier.object.quaternion);
      pourState.from[k].copy(carrier.center).addScaledVector(scratch.direction, carrier.halfLength * 0.9);
      if (isLast) {
        // 떨어질 자리로 곧장 — 포물선 한 번에 닿게 빠르기를 거꾸로 푼다
        const spot = leftoverFishSpot(carrier);
        pourState.velocity[k]
          .subVectors(spot, pourState.from[k])
          .divideScalar(LAST_FLIGHT)
          .add(scratch.direction.set(0, 0.5 * FALL_GRAVITY * M * LAST_FLIGHT, 0));
      } else pourState.velocity[k].copy(scratch.direction).multiplyScalar(0.7 * M);
    }
    const position = scratch.position;
    const heading = scratch.direction;
    if (isFalling) {
      const elapsed = (pour - releaseAt) * POUR_SECONDS;
      position.copy(pourState.from[k]).addScaledVector(pourState.velocity[k], elapsed);
      position.y -= 0.5 * FALL_GRAVITY * M * elapsed * elapsed;
      heading.copy(pourState.velocity[k]);
      heading.y -= FALL_GRAVITY * M * elapsed;
      if (isLast && elapsed >= LAST_FLIGHT) {
        // 뭍에 떨어져 파닥인다 — 소지품에 챙길 수 있다
        pourState.landed[k] = 1;
        inventory.spawn("lightFish", leftoverFishSpot(carrier));
        audio.play("첨벙");
        showNotice("한 마리는 따로 털어 앞에 떨궜다. 뭍에서 파닥인다 — 챙겨 두자.");
        hide(k);
        continue;
      }
      if (!isLast && position.y <= hearth.y) {
        pourState.landed[k] = 1;
        emitSparks(sparks, position.set(position.x, hearth.y, position.z), 7);
        audio.play("똑");
        hide(k);
        continue;
      }
    } else {
      // 통발 안에서 맴돈다 — 통발과 함께 움직인다
      const angle = time * (1.4 + (k % 4) * 0.25) + k * 1.7;
      const radius = (0.05 + (k % 3) * 0.03) * M;
      position
        .set(Math.cos(angle) * radius, Math.sin(angle * 1.3) * radius * 0.6, Math.sin(angle) * radius)
        .add(carrier.center);
      heading.set(-Math.sin(angle), 0, Math.cos(angle));
    }
    remaining += 1;
    if (heading.lengthSq() < 1e-8) heading.set(0, -1, 0);
    quaternion.setFromUnitVectors(FORWARD, heading.normalize());
    scale.setScalar(M * 0.75);
    matrix.compose(position, quaternion, scale);
    caughtFish.setMatrixAt(k, matrix);
    caughtEmbers.position.setXYZ(k, position.x, position.y, position.z);
    caughtEmbers.size.setX(k, 0.3 * M);
    caughtEmbers.alpha.setX(k, 0.35);
    caughtEmbers.color.setXYZ(k, EMBER.r * 1.2, EMBER.g * 1.2, EMBER.b * 1.2);
  }
  caughtFish.instanceMatrix.needsUpdate = true;
  caughtEmbers.commit();
  return remaining;
}
