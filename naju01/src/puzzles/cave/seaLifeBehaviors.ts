/**
 * 강 밑 생물의 매 프레임 움직임 — 사람이 다가오면 저마다 다르게 군다.
 *   오징어 — 떠 있다가 이따금 쭉 뻗어 나간다. 가까이 오면 눈앞으로 와 먹물을 뿜고 내뺀다
 *   문어   — 바닥에서 꿈틀댄다. 가까이 오면 먹물을 뿜고 솟구쳤다가 다시 내려앉는다
 *   복어   — 둥실 떠다니다 가까이 오면 가시 공으로 부풀고, 붙으면 찔린다
 *   참게   — 옆걸음으로 오가다 가까이 오면 집게를 치켜들고 달아난다
 *   뱀장어 · 넙치 · 쏨뱅이 — 바닥 가까이 느릿느릿. 넙치 · 쏨뱅이는 위장했다가 가까이 가야 정체가 드러난다
 *   떼     — 중심이 어슬렁, 마리마다 둘레를 돈다. 사람을 피해 흩어진다
 * 자리는 미터. 그리는 쪽(SeaLife)이 ref 로 받은 물체를 넘겨준다.
 */
import * as THREE from "three";

import { audio } from "../../scene/immersion/audio";
import { showNotice } from "../interaction";
import { M } from "../units";
import { FLOOR_Y, SURFACE_Y, floorY, getInkArmed, hurtBreath, stirSand } from "./caveState";
import { INK_COUNT, type Ink, type Mover, type School } from "./seaLifeModels";

const INK_LIFE = 3.0;
/** 먹물 한 번에 뿜는 알갱이 수 · 깎이는 숨(초) */
const INK_PUFF = 78;
const INK_DAMAGE = 7;
/**
 * 먹물 공격 — 가까이 가면 눈앞(카메라 앞 이만큼, 미터)으로 헤엄쳐 와서 얼굴에 대고 뿜는다. 한 번 들르면 이만큼 뿜고 달아나며,
 * 뿜은 먹이 날아와 화면에 닿기까지(초) · 다음 뿜기까지(초) · 다 뿜고 다시 덤비기까지(초)
 */
const INK_ATTACK = { trigger: 2.6, giveUp: 7, front: 1.05, shots: 1, travel: 0.28, between: 1.15, rest: 45 };
/** 복어 가시 — 부푼 복어에 이만큼(미터) 붙으면 찔린다 · 깎이는 숨 · 다시 찔리기까지(초) */
const SPIKE_RADIUS = 0.75;
const SPIKE_DAMAGE = 15;
const SPIKE_COOLDOWN = 3;
const SAND_CAMO = new THREE.Color("#B6AA8A");
const FLOUNDER_TRUE = new THREE.Color("#5E4A32");
const ROCK_CAMO = new THREE.Color("#5E6B69");
const STONEFISH_TRUE = new THREE.Color("#8A6448");

/** 한 프레임의 사람 자리와 시간 — 생물마다 같은 값을 본다 */
export interface Frame {
  time: number;
  dt: number;
  px: number;
  py: number;
  pz: number;
  /** 물속에 있나 — 뭍에서는 아무도 놀라지 않는다 */
  isNear: boolean;
  /** 바라보는 쪽(수평) */
  forward: THREE.Vector3;
  random: () => number;
}

const scratch = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const segmentPosition = new THREE.Vector3();
const segmentScale = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const HEAD_TURN = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
const fishScale = new THREE.Vector3();

/** 프레임마다 한 번 — 임시 회전을 처음 상태로 */
export function beginFrame() {
  quaternion.identity();
}

const distanceTo = (frame: Frame, point: THREE.Vector3) => Math.hypot(point.x - frame.px, point.z - frame.pz);
const awayFrom = (frame: Frame, point: THREE.Vector3, out: THREE.Vector3) =>
  out.set(point.x - frame.px, 0, point.z - frame.pz).normalize();

/** 먹물 한 번 — dir 은 뿜는 쪽의 반대(몸 → 사람이면 사람 쪽으로 날아간다). 얼굴에 대고 뿜을 땐 더 세게 */
function squirtInk(ink: Ink, random: () => number, at: THREE.Vector3, dir: THREE.Vector3, atFace = false) {
  const push = atFace ? 2.6 : 1;
  for (let n = 0; n < INK_PUFF; n++) {
    const k = ink.next;
    ink.next = (ink.next + 1) % INK_COUNT;
    ink.pos[k].copy(at);
    ink.vel[k].set(
      -dir.x * (0.5 + random()) * push + (random() - 0.5) * 0.7,
      -dir.y * (0.5 + random()) * push + (random() - 0.3) * 0.5,
      -dir.z * (0.5 + random()) * push + (random() - 0.5) * 0.7,
    );
    ink.age[k] = random() * 0.15;
  }
}

/**
 * 먹물 공격 — 가까이 가면 사람 눈앞으로 헤엄쳐 와 얼굴에 대고 뿜는다(뿜는 모습이 보이게). 한 번 뿜고 달아난다.
 * 공격 중이면 true — 그동안은 제 헤엄 대신 이걸 따른다
 */
function updateInkAttack(mover: Mover, distance: number, frame: Frame, ink: Ink) {
  const { time, dt, px, py, pz, isNear } = frame;
  if (mover.inkDue >= 0 && time >= mover.inkDue) {
    mover.inkDue = -1;
    if (isNear) {
      if (hurtBreath(INK_DAMAGE, "ink"))
        showNotice(`먹물을 뒤집어썼다 — 숨이 ${INK_DAMAGE} 줄었다.`, 2.4, { urgent: true });
    }
  }
  if (mover.shotsLeft <= 0) {
    // 한 번에 한 마리만 덤빈다 — 여럿이 같이 뿜으면 숨이 순식간에 바닥난다
    if (
      !getInkArmed() ||
      ink.attacker ||
      time - ink.lastAttackEnd < INK_ATTACK.rest ||
      !isNear ||
      distance > INK_ATTACK.trigger ||
      time - mover.scaredAt < INK_ATTACK.rest
    )
      return false;
    ink.attacker = mover;
    mover.shotsLeft = INK_ATTACK.shots;
    mover.nextShot = time + 0.7;
  }
  // 사람이 멀리 달아나면(제 굴에서 너무 멀어지면) 그만둔다
  if (!isNear || distance > INK_ATTACK.giveUp || mover.pos.distanceTo(mover.home) > INK_ATTACK.giveUp) {
    mover.shotsLeft = 0;
    mover.scaredAt = time;
    ink.attacker = null;
    return false;
  }
  // 눈앞 자리 — 바라보는 쪽으로 한 걸음, 눈높이 조금 아래
  const spot = scratch.set(px + frame.forward.x * INK_ATTACK.front, py - 0.1, pz + frame.forward.z * INK_ATTACK.front);
  mover.pos.lerp(spot, 1 - Math.exp(-dt * 4.5));
  mover.vel.set(0, 0, 0);
  mover.heading = Math.atan2(px - mover.pos.x, pz - mover.pos.z);
  if (time >= mover.nextShot && mover.pos.distanceTo(spot) < 0.4) {
    const away = new THREE.Vector3(mover.pos.x - px, mover.pos.y - py, mover.pos.z - pz).normalize();
    squirtInk(ink, frame.random, mover.pos, away, true);
    audio.play("첨벙");
    mover.inkDue = time + INK_ATTACK.travel;
    mover.shotsLeft -= 1;
    mover.nextShot = time + INK_ATTACK.between;
    // 뿜은 힘에 살짝 뒤로 밀린다
    mover.pos.addScaledVector(away, 0.25);
    if (mover.shotsLeft <= 0) {
      // 다 뿜었으면 내뺀다 — 다른 녀석은 쉬었다가 덤빈다
      mover.scaredAt = time;
      ink.attacker = null;
      ink.lastAttackEnd = time;
      mover.vel.copy(away.setY(0).normalize()).multiplyScalar(3.2);
      mover.vel.y = 0.4;
      return false;
    }
  }
  return true;
}

/** 오징어 — 떠 있다가 이따금 쭉. 가까이 오면 먹물 + 내뺌 */
export function updateSquid(mover: Mover, group: THREE.Group, arms: THREE.Group | null, frame: Frame, ink: Ink) {
  const { time, dt, random } = frame;
  const distance = distanceTo(frame, mover.pos);
  const sinceScare = time - mover.scaredAt;
  const isAttacking = updateInkAttack(mover, distance, frame, ink);
  mover.until -= dt;
  if (!isAttacking && mover.until <= 0 && sinceScare > 2) {
    mover.until = 2.5 + random() * 2.5;
    mover.target.set(
      mover.home.x + (random() - 0.5) * 3,
      mover.home.y + (random() - 0.5) * 0.8,
      mover.home.z + (random() - 0.5) * 3,
    );
    // 쭉 — 몸을 뻗어 한 번에 나아간다
    mover.vel.add(scratch.subVectors(mover.target, mover.pos).normalize().multiplyScalar(0.9));
  }
  mover.vel.multiplyScalar(Math.exp(-dt * 1.4));
  mover.pos.addScaledVector(mover.vel, dt);
  mover.pos.y = THREE.MathUtils.clamp(mover.pos.y, floorY(mover.pos.x, mover.pos.z) + 0.6, SURFACE_Y - 0.5);
  const speed = mover.vel.length();
  if (!isAttacking && speed > 0.05)
    mover.heading += (Math.atan2(mover.vel.x, mover.vel.z) - mover.heading) * Math.min(1, dt * 3);
  group.position.copy(mover.pos);
  group.rotation.set(0, mover.heading, 0);
  // 지느러미 펄럭 · 다리 오므렸다 폈다(빠를수록 모인다)
  const pump = 1 - Math.min(0.35, speed * 0.25);
  group.scale.set(pump, pump, 1 + (1 - pump) * 0.6);
  if (arms)
    arms.children.forEach((arm, k) => (arm.rotation.x = Math.sin(time * 3 + k) * 0.18 * (1 - Math.min(1, speed))));
}

/** 문어 — 바닥에서 꿈틀. 가까이 오면 먹물 + 솟구쳤다 내려앉는다 */
export function updateOctopus(
  mover: Mover,
  group: THREE.Group,
  segments: THREE.InstancedMesh,
  suckers: THREE.InstancedMesh | null,
  index: number,
  frame: Frame,
  ink: Ink,
) {
  const { time, dt } = frame;
  const distance = distanceTo(frame, mover.pos);
  const isAttacking = updateInkAttack(mover, distance, frame, ink);
  const since = time - mover.scaredAt;
  const ground = floorY(mover.pos.x, mover.pos.z);
  if (isAttacking) {
    // 눈앞에 떠 있는 동안은 먹물 공격이 자리를 잡는다
  } else if (since < 2.4) {
    mover.vel.y -= 1.1 * dt;
  } else {
    mover.vel.multiplyScalar(Math.exp(-dt * 3));
    // 천천히 집(바위 곁)으로 기어 돌아간다
    mover.vel.x += (mover.home.x - mover.pos.x) * 0.15 * dt;
    mover.vel.z += (mover.home.z - mover.pos.z) * 0.15 * dt;
  }
  mover.vel.x *= Math.exp(-dt * 0.8);
  mover.vel.z *= Math.exp(-dt * 0.8);
  mover.pos.addScaledVector(mover.vel, dt);
  if (mover.pos.y < ground) {
    mover.pos.y = ground;
    mover.vel.y = 0;
  }
  const swim = THREE.MathUtils.clamp((mover.pos.y - ground) / 0.6, 0, 1);
  if (!isAttacking && Math.hypot(mover.vel.x, mover.vel.z) > 0.1)
    mover.heading += (Math.atan2(mover.vel.x, mover.vel.z) - mover.heading) * Math.min(1, dt * 4);
  group.position.copy(mover.pos);
  group.rotation.y = mover.heading;
  // 다리 여덟 × 마디 일곱 — 바닥에서는 둘레로 퍼져 꿈틀, 헤엄칠 때는 뒤(아래)로 모여 늘어진다
  let segment = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (let j = 0; j < 7; j++) {
      const t = j / 6;
      const curl = Math.sin(time * 1.6 + k * 1.3 + j * 0.7) * 0.25 * t;
      const spreadR = 0.07 + t * 0.26;
      const spreadX = Math.cos(a + curl) * spreadR;
      const spreadZ = Math.sin(a + curl) * spreadR;
      const spreadY = 0.02 + Math.max(0, Math.sin(time * 1.2 + k + j)) * 0.03 * t + (t > 0.75 ? (t - 0.75) * 0.25 : 0);
      // 헤엄 자세 — 아래로 늘어지며 모인다
      const trailX = Math.cos(a) * (0.05 + t * 0.03);
      const trailZ = Math.sin(a) * (0.05 + t * 0.03) - t * 0.1;
      const trailY = -t * 0.32;
      segmentPosition.set(
        THREE.MathUtils.lerp(spreadX, trailX, swim),
        THREE.MathUtils.lerp(spreadY, trailY, swim),
        THREE.MathUtils.lerp(spreadZ, trailZ, swim),
      );
      const r = 0.026 * (1 - t * 0.75);
      segmentScale.setScalar(r);
      matrix.compose(segmentPosition, quaternion, segmentScale);
      segments.setMatrixAt(segment, matrix);
      if (suckers) {
        segmentPosition.y -= r * 0.75;
        segmentScale.setScalar(r * 0.55);
        matrix.compose(segmentPosition, quaternion, segmentScale);
        suckers.setMatrixAt(segment, matrix);
      }
      segment++;
    }
  }
  segments.instanceMatrix.needsUpdate = true;
  if (suckers) suckers.instanceMatrix.needsUpdate = true;
  // 숨 쉬듯 머리가 오르내린다
  const head = group.children[0];
  if (head) head.scale.set(0.1, 0.13 + Math.sin(time * 1.8 + index) * 0.008, 0.11);
}

/** 복어 — 둥실. 가까이 오면 가시 공으로 부푼다. 부푼 정도(0~1)를 돌려준다 */
export function updatePuffer(mover: Mover, group: THREE.Group, body: THREE.Group, index: number, frame: Frame) {
  const { time, dt, px, py, pz, isNear, random } = frame;
  const distance = Math.hypot(mover.pos.x - px, mover.pos.z - pz, (mover.pos.y - py) * 0.5);
  if (isNear && distance < 2.3 && time - mover.scaredAt > 6) mover.scaredAt = time;
  const since = time - mover.scaredAt;
  const puff =
    since < 0.4
      ? THREE.MathUtils.smoothstep(since / 0.4, 0, 1)
      : since < 4.6
        ? 1
        : since < 6
          ? 1 - THREE.MathUtils.smoothstep((since - 4.6) / 1.4, 0, 1)
          : 0;
  mover.until -= dt;
  if (mover.until <= 0) {
    mover.until = 3 + random() * 3;
    mover.target.set(
      mover.home.x + (random() - 0.5) * 1.8,
      mover.home.y + (random() - 0.5) * 0.5,
      mover.home.z + (random() - 0.5) * 1.8,
    );
  }
  scratch.subVectors(mover.target, mover.pos);
  if (scratch.length() > 0.05)
    mover.vel.lerp(scratch.normalize().multiplyScalar(0.22 * (1 - puff)), Math.min(1, dt * 1.5));
  mover.pos.addScaledVector(mover.vel, dt);
  // 부풀면 살짝 떠오른다
  group.position.set(mover.pos.x, mover.pos.y + puff * 0.12 + Math.sin(time * 1.4 + index) * 0.03, mover.pos.z);
  if (mover.vel.length() > 0.02 && puff < 0.5)
    mover.heading += (Math.atan2(mover.vel.x, mover.vel.z) - mover.heading) * Math.min(1, dt * 2);
  group.rotation.y = mover.heading + puff * Math.sin(time * 0.8) * 0.4;
  // 부푼 가시에 붙으면 찔린다
  if (
    isNear &&
    puff > 0.6 &&
    time - mover.hitAt > SPIKE_COOLDOWN &&
    Math.hypot(mover.pos.x - px, mover.pos.y - (py - 0.3), mover.pos.z - pz) < SPIKE_RADIUS
  ) {
    mover.hitAt = time;
    if (hurtBreath(SPIKE_DAMAGE, "spike")) {
      audio.play("똑");
      showNotice(`복어 가시에 찔렸다 — 숨이 ${SPIKE_DAMAGE} 줄었다.`, 2.6, { urgent: true });
    }
  }
  body.scale.setScalar(1 + puff * 1.15);
  return puff;
}

/** 복어 가시 — 부푼 정도대로 길어진다. 부푼 정도가 바뀔 때만 다시 쓴다 */
export function placeSpikes(
  spikes: THREE.InstancedMesh,
  frames: { position: THREE.Vector3; quaternion: THREE.Quaternion }[],
  puff: number,
) {
  const spikeScale = new THREE.Vector3(0.6 + puff * 0.4, 0.08 + puff * 0.92, 0.6 + puff * 0.4);
  frames.forEach((frame, k) => {
    matrix.compose(frame.position, frame.quaternion, spikeScale);
    spikes.setMatrixAt(k, matrix);
  });
  spikes.instanceMatrix.needsUpdate = true;
}

/** 참게 — 옆걸음. 가까이 오면 집게를 치켜들고 내뺀다 */
export function updateCrab(
  mover: Mover,
  group: THREE.Group,
  legs: THREE.Group | null,
  claws: THREE.Group | null,
  index: number,
  frame: Frame,
) {
  const { time, dt, isNear, random } = frame;
  const distance = distanceTo(frame, mover.pos);
  const isAlarmed = isNear && distance < 2.2;
  if (isAlarmed) mover.scaredAt = time;
  const isScared = time - mover.scaredAt < 1.6;
  mover.until -= dt;
  if (isAlarmed) {
    awayFrom(frame, mover.pos, scratch);
    mover.target.set(mover.pos.x + scratch.x * 1.5, 0, mover.pos.z + scratch.z * 1.5);
  } else if (mover.until <= 0) {
    mover.until = 1.5 + random() * 3.5;
    mover.target.set(mover.home.x + (random() - 0.5) * 2.2, 0, mover.home.z + (random() - 0.5) * 2.2);
  }
  scratch.set(mover.target.x - mover.pos.x, 0, mover.target.z - mover.pos.z);
  const far = scratch.length();
  const speed = far > 0.06 ? (isScared ? 0.9 : 0.25) : 0;
  if (far > 0.06) scratch.normalize();
  mover.vel.x += (scratch.x * speed - mover.vel.x) * Math.min(1, dt * 6);
  mover.vel.z += (scratch.z * speed - mover.vel.z) * Math.min(1, dt * 6);
  mover.pos.x += mover.vel.x * dt;
  mover.pos.z += mover.vel.z * dt;
  mover.pos.y = floorY(mover.pos.x, mover.pos.z);
  // 몸은 옆으로 걷는다 — 머리(+z)가 가는 쪽과 직각
  const moving = Math.hypot(mover.vel.x, mover.vel.z);
  if (moving > 0.05)
    mover.heading += (Math.atan2(mover.vel.x, mover.vel.z) - Math.PI / 2 - mover.heading) * Math.min(1, dt * 2);
  group.position.copy(mover.pos);
  group.rotation.y = mover.heading;
  if (legs)
    legs.children.forEach(
      (leg, k) =>
        (leg.rotation.x = Math.sin(time * 18 * Math.min(1, moving * 2) + k * 1.7) * 0.35 * Math.min(1, moving * 3)),
    );
  if (claws)
    claws.rotation.x +=
      ((isScared ? -0.9 : 0) + Math.sin(time * 2 + index) * 0.05 - claws.rotation.x) * Math.min(1, dt * 8);
}

/** 뱀장어 — 바닥 가까이 느릿느릿 */
export function updateEel(mover: Mover, mesh: THREE.Mesh, index: number, frame: Frame) {
  const { time, dt, isNear, random } = frame;
  mover.until -= dt;
  const distance = distanceTo(frame, mover.pos);
  if (isNear && distance < 2) {
    awayFrom(frame, mover.pos, scratch);
    mover.target.set(mover.pos.x + scratch.x * 2, 0, mover.pos.z + scratch.z * 2);
    mover.until = 2;
  } else if (mover.until <= 0) {
    mover.until = 4 + random() * 4;
    mover.target.set(mover.home.x + (random() - 0.5) * 3, 0, mover.home.z + (random() - 0.5) * 3);
  }
  scratch.set(mover.target.x - mover.pos.x, 0, mover.target.z - mover.pos.z);
  const speed = scratch.length() > 0.1 ? (isNear && distance < 2 ? 0.7 : 0.22) : 0;
  if (scratch.lengthSq() > 0) scratch.normalize();
  mover.vel.lerp(scratch.multiplyScalar(speed), Math.min(1, dt * 1.2));
  mover.pos.addScaledVector(mover.vel, dt);
  mover.pos.y = floorY(mover.pos.x, mover.pos.z) + 0.1 + Math.sin(time * 0.7 + index) * 0.04;
  if (mover.vel.length() > 0.03)
    mover.heading += (Math.atan2(mover.vel.x, mover.vel.z) - mover.heading) * Math.min(1, dt * 1.5);
  mesh.position.copy(mover.pos);
  mesh.rotation.y = mover.heading;
}

/** 넙치 — 모래빛으로 엎드려 있다가 가까이 오면 제 빛깔이 드러나며 모래를 털고 미끄러져 달아난다 */
export function updateFlounder(mover: Mover, group: THREE.Group, material: THREE.MeshToonMaterial, frame: Frame) {
  const { time, dt, isNear } = frame;
  if (isNear && distanceTo(frame, mover.pos) < 1.8 && time - mover.scaredAt > 5) {
    mover.scaredAt = time;
    awayFrom(frame, mover.pos, scratch);
    mover.vel.copy(scratch).multiplyScalar(1.4);
    stirSand(0.12);
  }
  const since = time - mover.scaredAt;
  const reveal = since < 0.3 ? since / 0.3 : since < 2.5 ? 1 : Math.max(0, 1 - (since - 2.5) / 2.5);
  mover.vel.multiplyScalar(Math.exp(-dt * 1.3));
  mover.pos.addScaledVector(mover.vel, dt);
  const ground = floorY(mover.pos.x, mover.pos.z);
  const swimming = Math.min(1, mover.vel.length() * 2);
  mover.pos.y = ground + 0.015 + swimming * 0.12;
  if (mover.vel.length() > 0.05)
    mover.heading += (Math.atan2(mover.vel.x, mover.vel.z) - mover.heading) * Math.min(1, dt * 3);
  group.position.copy(mover.pos);
  group.rotation.set(0, mover.heading, 0);
  // 헤엄칠 땐 몸 가장자리가 물결친다
  const fringe = group.children[1];
  if (fringe)
    fringe.scale.set(
      0.24,
      0.012 + Math.sin(time * 9) * 0.004 * swimming,
      0.15 + Math.sin(time * 9 + 1) * 0.01 * swimming,
    );
  material.color.copy(SAND_CAMO).lerp(FLOUNDER_TRUE, reveal);
}

/** 쏨뱅이 — 바위빛으로 웅크려 있다가 가까이 오면 지느러미를 펼치고 빛깔이 드러난다 */
export function updateStonefish(
  mover: Mover,
  group: THREE.Group,
  material: THREE.MeshToonMaterial,
  index: number,
  frame: Frame,
) {
  const { time, isNear } = frame;
  if (isNear && distanceTo(frame, mover.pos) < 1.6) mover.scaredAt = time;
  const since = time - mover.scaredAt;
  const reveal = since < 0.4 ? since / 0.4 : since < 3 ? 1 : Math.max(0, 1 - (since - 3) / 3);
  group.position.copy(mover.pos);
  group.position.y += reveal * 0.05;
  group.rotation.set(0, mover.heading + Math.sin(time * 0.5 + index) * 0.1, 0);
  const fins = group.children[2];
  if (fins) fins.scale.setScalar(0.25 + reveal * 0.75 + Math.sin(time * 6) * 0.05 * reveal);
  material.color.copy(ROCK_CAMO).lerp(STONEFISH_TRUE, reveal);
}

/** 떼 — 중심이 어슬렁, 마리마다 그 둘레를 돈다. 사람을 피해 흩어진다 */
export function updateSchool(
  school: School,
  size: number,
  roam: { x: number[]; z: number[] },
  wander: number,
  frame: Frame,
) {
  const { dt, isNear, random } = frame;
  const center = school.center;
  const distance = distanceTo(frame, center.pos);
  const isFleeing = isNear && distance < 3.2;
  center.until -= dt;
  if (isFleeing) {
    awayFrom(frame, center.pos, scratch);
    center.target.set(center.pos.x + scratch.x * 3, center.pos.y, center.pos.z + scratch.z * 3);
  } else if (center.until <= 0) {
    center.until = 3 + random() * 4;
    center.target.set(
      THREE.MathUtils.lerp(roam.x[0], roam.x[1], random()),
      FLOOR_Y + 1.1 + random() * 1.8,
      THREE.MathUtils.lerp(roam.z[0], roam.z[1], random()),
    );
  }
  scratch.subVectors(center.target, center.pos);
  if (scratch.length() > 0.05)
    center.vel.lerp(scratch.normalize().multiplyScalar(isFleeing ? 1.6 : wander), Math.min(1, dt * 1.5));
  center.pos.addScaledVector(center.vel, dt);
  center.pos.x = THREE.MathUtils.clamp(center.pos.x, roam.x[0], roam.x[1]);
  center.pos.z = THREE.MathUtils.clamp(center.pos.z, roam.z[0], roam.z[1]);
  school.fish.forEach((fish, k) => {
    fish.a += dt * fish.speed * (isFleeing ? 2.2 : 1);
    const spread = isFleeing ? 1.8 : 1;
    scratch.set(
      center.pos.x + Math.cos(fish.a) * fish.r * spread,
      center.pos.y + fish.y * spread + Math.sin(fish.a * 2) * 0.05,
      center.pos.z + Math.sin(fish.a) * fish.r * spread,
    );
    fish.vel.subVectors(scratch, fish.pos).multiplyScalar(Math.min(1, dt * 6) / Math.max(dt, 1e-3));
    fish.pos.lerp(scratch, Math.min(1, dt * 6));
    fish.pos.y = Math.max(fish.pos.y, floorY(fish.pos.x, fish.pos.z) + 0.3);
    if (fish.vel.lengthSq() > 1e-4) {
      lookMatrix.lookAt(ORIGIN, fish.vel, UP);
      quaternion.setFromRotationMatrix(lookMatrix).multiply(HEAD_TURN);
    }
    fishScale.setScalar(size * M);
    matrix.compose(scratch.copy(fish.pos).multiplyScalar(M), quaternion, fishScale);
    school.mesh.setMatrixAt(k, matrix);
  });
  school.mesh.instanceMatrix.needsUpdate = true;
}

/** 먹물 — 뿜어진 뒤 퍼지며 옅어진다 */
export function updateInkCloud(ink: Ink, dt: number) {
  const { points } = ink;
  for (let k = 0; k < INK_COUNT; k++) {
    ink.age[k] += dt;
    const age = ink.age[k];
    if (age > INK_LIFE) {
      points.alpha.setX(k, 0);
      continue;
    }
    ink.vel[k].multiplyScalar(Math.exp(-dt * 1.8));
    ink.vel[k].y += 0.05 * dt;
    ink.pos[k].addScaledVector(ink.vel[k], dt);
    const pos = ink.pos[k];
    points.position.setXYZ(k, pos.x * M, pos.y * M, pos.z * M);
    const t = age / INK_LIFE;
    points.size.setX(k, 0.12 + t * 0.55);
    points.alpha.setX(k, 0.95 * (1 - t * t) * Math.min(1, age * 8));
    points.color.setXYZ(k, 0.02, 0.018, 0.024);
  }
  points.commit();
}
