/**
 * 통발 셋 — 씬1 배치 무리(씬1.통발)를 실행 중에 읽어 같은 자리 · 모양의 퍼즐 통발로 바꿔 끼운다(편집기로 옮겨도 따라온다).
 * 뭍 → 굴러서 물속 → 줄을 당겨 뭍으로 → 틀린 통발은 다시 물속. 줄은 말뚝에서 통발 막힌 끝까지 이어진다.
 */
import * as THREE from "three";

import { GROUP_IDS } from "../../placement/editFile";
import { audio } from "../../scene/immersion/audio";
import { buildStrawShoeGeometry } from "../itemLooks";
import { makeToonMaterial } from "../materials";
import { M, groundY } from "../units";

/** 말뚝 — 줄은 서로 엇갈려 통발 자리만 보고는 어느 줄인지 모른다. 떨림을 보고 골라야 한다 */
export const STAKES = [
  { x: 22.75, z: 43.45, rope: "흰 줄", color: "#D9CFB4" },
  { x: 23.35, z: 43.6, rope: "붉은 줄", color: "#A3402F" },
  { x: 23.95, z: 43.72, rope: "검은 줄", color: "#2F2A26" },
];
const STAKE_HEIGHT = 0.85;
const STAKE_RADIUS = 0.045;
/** 통발 n 번의 줄이 매인 말뚝 */
const TRAP_TO_STAKE = [2, 0, 1];
/** 입구가 물살을 보게 떨어지는 통발 — 이것만 불티가 든다 */
export const CATCHING_TRAP = 1;
/** 틀린 줄 통발에 든 것 — 붉은 줄은 엉킨 미역 줄기, 검은 줄은 어부의 짚신 한 짝(줍지 않아도 풀리는 숨은 단서) */
export const SEAWEED_ROPE = "붉은 줄";
export const SHOE_ROPE = "검은 줄";
/** 굴려 넣은 통발이 가라앉는 곳 — 뭍 자리에서 강 쪽으로(미터) */
const THROW_OUT = 1.8;
const ROLL_SECONDS = 1.5;
const PULL_SECONDS = 1.8;
/** 틀린 통발이 뭍에 잠시 보였다가 다시 물로 돌아가기까지(초) */
const SHOW_ASHORE_SECONDS = 2.2;

/** baiting = 뭍에서 조개가 입구로 들어가는 동안 기다린다 */
export type TrapPlace = "shore" | "baiting" | "rolling" | "water" | "pulling" | "landed" | "returning";

export interface Trap {
  index: number;
  /** 줄이 매인 말뚝 번호 */
  stake: number;
  object: THREE.Group;
  mesh: THREE.InstancedMesh;
  baseQuaternion: THREE.Quaternion;
  shorePosition: THREE.Vector3;
  waterPosition: THREE.Vector3;
  /** 건져 올려 내려놓는 자리(말뚝 곁) */
  landPosition: THREE.Vector3;
  place: TrapPlace;
  /** 지금 움직임의 진행 0~1 */
  motion: number;
  /** 물속에서 돌려 놓는 yaw(원래 자세에 더한다) */
  waterYaw: number;
  /** 물속 입구가 보는 쪽(절대 yaw) */
  mouthAngle: number;
  centerLocalY: number;
  height: number;
  halfLength: number;
  /** 통발 가운데(유닛) — [E] 로 겨누는 자리. 매 프레임 자세에서 다시 센다 */
  center: THREE.Vector3;
  /** 막힌 끝(유닛) — 줄이 매이는 곳 */
  closedEnd: THREE.Vector3;
  /** 물속 입구(유닛) — 물고기가 빨려 드는 자리 */
  mouthWater: THREE.Vector3;
  caught: number;
  /** 줄 떨림 0~1 */
  tug: number;
  rope: THREE.Mesh;
  /** 마지막으로 줄을 지은 자리 — 같으면 다시 짓지 않는다 */
  ropeKey: string;
  /** 줄이 수면을 지나는 자리(유닛). 뭍이면 null */
  surface: THREE.Vector3 | null;
  /** 다음 줄 짓기 때 수면 자리에서 물을 튀긴다 */
  splashPending: boolean;
  /** 뭍에 올라온 뒤 흐른 시간(초) */
  waitTimer: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const scratch = {
  yaw: new THREE.Quaternion(),
  roll: new THREE.Quaternion(),
  matrix: new THREE.Matrix4(),
  axis: new THREE.Vector3(),
  side: new THREE.Vector3(),
};

/** 배치 무리 「씬1.통발」 */
export function findTrapSource(scene: THREE.Scene): THREE.InstancedMesh | null {
  let found: THREE.InstancedMesh | null = null;
  scene.traverse((object) => {
    if (!found && object.name === GROUP_IDS.scene1FishTraps && (object as THREE.InstancedMesh).isInstancedMesh)
      found = object as THREE.InstancedMesh;
  });
  return found;
}

/** 대나무 색은 인스턴스 색에 있다. 무리가 처음 설 때는 아직 비어 있어 늦게 채워지면 그때 옮긴다 */
export function copyTrapColors(source: THREE.InstancedMesh, traps: Trap[]) {
  if (!source.instanceColor) return;
  const color = new THREE.Color();
  for (const trap of traps) {
    if (trap.mesh.instanceColor || trap.index >= source.count) continue;
    source.getColorAt(trap.index, color);
    trap.mesh.setColorAt(0, color);
    trap.mesh.instanceColor!.needsUpdate = true;
  }
}

/** 배치 무리의 통발 하나를 퍼즐 통발로 — 앞서 만든 것이 있으면 자리(place) · 진행 · 잡은 수 · 줄을 이어받는다 */
export function adoptTrap(
  source: THREE.InstancedMesh,
  index: number,
  previous: Trap | undefined,
  ropeMaterials: THREE.Material[],
): Trap {
  const bounds = source.geometry.boundingBox!;
  source.getMatrixAt(index, scratch.matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  scratch.matrix.decompose(position, quaternion, scale);

  // 무리와 같은 인스턴스 메시로 하나씩 — 대나무 색이 인스턴스 색에 들어 있다
  const mesh = new THREE.InstancedMesh(source.geometry, source.material, 1);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const object = new THREE.Group();
  object.add(mesh);
  object.position.copy(position);
  // 옮겨 둔 자세 그대로 — 빠뜨리면 기본 자세로 서서 땅에 박힌다
  object.quaternion.copy(quaternion);
  object.scale.copy(scale);

  const height = (bounds.max.y - bounds.min.y) * scale.y;
  const halfLength = ((bounds.max.z - bounds.min.z) / 2) * scale.z;
  const waterPosition = position.clone();
  waterPosition.z += THROW_OUT * M;
  waterPosition.y = -height * 2.2; // 다 잠긴다 — 어느 것에 불티가 들었는지 눈으로는 모른다
  const stake = TRAP_TO_STAKE[index % TRAP_TO_STAKE.length] % STAKES.length;
  const landPosition = new THREE.Vector3(
    STAKES[stake].x * M,
    groundY(STAKES[stake].x, STAKES[stake].z + 0.5) * M,
    (STAKES[stake].z + 0.5) * M,
  );
  // 들어가는 통발만 입구가 물살 위쪽(−x)을, 나머지는 아래쪽을 본다
  const mouthAngle = index === CATCHING_TRAP ? -Math.PI / 2 : Math.PI / 2;
  const baseDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const baseAngle = Math.atan2(baseDirection.x, baseDirection.z);
  return {
    index,
    stake,
    object,
    mesh,
    baseQuaternion: quaternion,
    shorePosition: position.clone(),
    waterPosition,
    landPosition,
    // 불씨가 드는 흰 줄 통발만 뭍에 두고, 나머지 둘은 처음부터 물속에 가라앉아 있다
    place: previous?.place ?? (index === CATCHING_TRAP ? "shore" : "water"),
    motion: previous?.motion ?? 0,
    waterYaw: mouthAngle - baseAngle,
    mouthAngle,
    centerLocalY: (bounds.max.y + bounds.min.y) / 2,
    height,
    halfLength,
    center: new THREE.Vector3(),
    closedEnd: new THREE.Vector3(),
    mouthWater: new THREE.Vector3(),
    caught: previous?.caught ?? 0,
    tug: 0,
    rope: previous?.rope ?? new THREE.Mesh(new THREE.BufferGeometry(), ropeMaterials[stake]),
    ropeKey: "",
    surface: null,
    splashPending: false,
    waitTimer: 0,
  };
}

/** 말뚝 — 꼭대기에 줄과 같은 색 천을 감아 어느 줄인지 보이게 */
export function buildStake(index: number) {
  const { x, z, color } = STAKES[index];
  const group = new THREE.Group();
  const wood = new THREE.CylinderGeometry(STAKE_RADIUS * 0.8 * M, STAKE_RADIUS * M, STAKE_HEIGHT * M, 7);
  wood.translate(0, (STAKE_HEIGHT / 2) * M, 0);
  const pole = new THREE.Mesh(wood, makeToonMaterial("#5A4632"));
  pole.castShadow = true;
  const cloth = new THREE.CylinderGeometry(STAKE_RADIUS * 1.25 * M, STAKE_RADIUS * 1.25 * M, 0.13 * M, 8);
  cloth.translate(0, (STAKE_HEIGHT - 0.12) * M, 0);
  const tag = new THREE.Mesh(cloth, makeToonMaterial(color));
  group.add(pole, tag);
  group.position.set(x * M, groundY(x, z) * M, z * M);
  return group;
}

/** 말뚝 꼭대기(유닛) — 줄이 매이고 [E] 로 겨누는 자리 */
export const stakeTop = (index: number) =>
  new THREE.Vector3(
    STAKES[index].x * M,
    (groundY(STAKES[index].x, STAKES[index].z) + STAKE_HEIGHT - 0.06) * M,
    STAKES[index].z * M,
  );

/** 통발에 엉킨 미역 줄기 — 굽이진 띠 여럿, 몇 가닥은 통발 밖으로 늘어진다. 미터, 통발 가운데가 원점 */
export function buildSeaweedTangle() {
  const group = new THREE.Group();
  const material = makeToonMaterial("#4E5B2C", { side: THREE.DoubleSide });
  for (let k = 0; k < 7; k++) {
    const length = 0.35 + (k % 3) * 0.18;
    const geometry = new THREE.PlaneGeometry(0.035 + (k % 2) * 0.015, length, 1, 10);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      // 물결치며 비틀린 띠
      position.setZ(i, Math.sin(y * 14 + k) * 0.03);
      position.setX(i, position.getX(i) + Math.sin(y * 6 + k * 2) * 0.04);
    }
    geometry.computeVertexNormals();
    const strand = new THREE.Mesh(geometry, material);
    const angle = (k / 7) * Math.PI * 2;
    strand.position.set(Math.cos(angle) * 0.08, Math.sin(angle) * 0.05, (k - 3) * 0.06);
    strand.rotation.set(Math.PI / 2 + (k % 3) * 0.4, angle, (k % 2) * 0.6);
    group.add(strand);
  }
  group.scale.setScalar(M);
  return group;
}

/** 통발에 걸린 짚신 — 뭍에 올라오면 털어 떨궈 주울 수 있다 */
export function buildStrawShoe() {
  const mesh = new THREE.Mesh(buildStrawShoeGeometry(), makeToonMaterial("#8E7748"));
  mesh.scale.setScalar(M * 1.3);
  return mesh;
}

/** 통발의 자리마다 할 일 — 컴포넌트가 진행 상태를 보고 답한다 */
export interface TrapMotionHooks {
  /** 조개가 입구로 다 들어갔나(ClamDig 가 baited 로 바꾸면) — 그때 굴러간다 */
  isBaitIn: () => boolean;
  /** 쏟는 중이라 자세를 밖에서 잡는 통발인가 */
  isPouring: (trap: Trap) => boolean;
  /** 뭍에 그대로 두는 통발인가(건진 통발) — 아니면 잠시 보여 주고 다시 물로 */
  staysAshore: (trap: Trap) => boolean;
  /** 뭍에 올라온 순간 */
  onLanded: (trap: Trap) => void;
}

/** 통발 한 프레임 — 자리에 따라 움직이고 자세를 잡는다. 자리가 바뀌면 true */
export function advanceTrap(trap: Trap, dt: number, hooks: TrapMotionHooks) {
  let changed = false;
  if (trap.place === "shore" || trap.place === "baiting") {
    trap.object.position.copy(trap.shorePosition);
    trap.object.quaternion.copy(trap.baseQuaternion);
    if (trap.place === "baiting" && hooks.isBaitIn()) {
      trap.place = "rolling";
      trap.motion = 0;
      changed = true;
    }
  } else if (trap.place === "rolling") {
    trap.motion = Math.min(1, trap.motion + dt / ROLL_SECONDS);
    const t = THREE.MathUtils.smootherstep(trap.motion, 0, 1);
    trap.object.position.lerpVectors(trap.shorePosition, trap.waterPosition, t);
    trap.object.position.y += Math.sin(t * Math.PI) * 0.15 * M;
    // 긴 축으로 데굴데굴 구르며 물 쪽(+z)을 향해 돌아눕는다
    scratch.yaw.setFromAxisAngle(UP, trap.waterYaw * t);
    scratch.roll.setFromAxisAngle(FORWARD, t * Math.PI * 4);
    trap.object.quaternion.copy(scratch.yaw).multiply(trap.baseQuaternion).multiply(scratch.roll);
    if (trap.motion >= 1) {
      trap.place = "water";
      audio.play("첨벙");
      changed = true;
    }
  } else if (trap.place === "water") {
    trap.object.position.copy(trap.waterPosition);
    scratch.yaw.setFromAxisAngle(UP, trap.waterYaw);
    trap.object.quaternion.copy(scratch.yaw).multiply(trap.baseQuaternion);
  } else if (trap.place === "pulling" || trap.place === "returning") {
    const isPulling = trap.place === "pulling";
    trap.motion = Math.min(1, trap.motion + dt / (isPulling ? PULL_SECONDS : ROLL_SECONDS));
    const t = THREE.MathUtils.smootherstep(trap.motion, 0, 1);
    const [from, to] = isPulling ? [trap.waterPosition, trap.landPosition] : [trap.landPosition, trap.waterPosition];
    trap.object.position.lerpVectors(from, to, t);
    trap.object.position.y += Math.sin(t * Math.PI) * 0.3 * M;
    trap.tug = Math.max(trap.tug, isPulling ? 0.5 : 0);
    if (trap.motion >= 1) {
      changed = true;
      if (isPulling) {
        trap.place = "landed";
        trap.waitTimer = 0;
        hooks.onLanded(trap);
      } else trap.place = "water";
    }
  } else if (trap.place === "landed") {
    if (!hooks.isPouring(trap)) trap.object.position.copy(trap.landPosition);
    if (!hooks.staysAshore(trap)) {
      trap.waitTimer += dt;
      if (trap.waitTimer > SHOW_ASHORE_SECONDS) {
        trap.place = "returning";
        trap.motion = 0;
        changed = true;
      }
    }
  }
  return changed;
}

/** 자세에서 가운데 · 막힌 끝 · 물속 입구 자리를 다시 센다 */
export function updateTrapAnchors(trap: Trap) {
  trap.center
    .set(0, trap.centerLocalY, 0)
    .multiply(trap.object.scale)
    .applyQuaternion(trap.object.quaternion)
    .add(trap.object.position);
  scratch.axis.set(0, 0, 1).applyQuaternion(trap.object.quaternion);
  trap.closedEnd.copy(scratch.axis).multiplyScalar(trap.halfLength).add(trap.center);
  // 물속 입구 — 들어갈 자리는 가라앉은 자리 기준
  scratch.axis.set(Math.sin(trap.mouthAngle), 0, Math.cos(trap.mouthAngle));
  trap.mouthWater.copy(trap.waterPosition).addScaledVector(scratch.axis, trap.halfLength);
}

/**
 * 줄 — 통발 막힌 끝 → 말뚝. 가운데가 처지고, 떨릴 때는 옆으로 잘게 흔들린다. 가만히 있으면 다시 짓지 않는다.
 * 물에 잠긴 통발이면 말뚝에서 땅을 타고 내려와 수면 위에 떠서 통발 바로 위까지 간 뒤 물속으로 든다 —
 * 물에 드는 자리가 물이 튀는 자리다(돌려준다). 뭍에 있으면 처지는 줄 하나
 */
export function updateRope(trap: Trap, to: THREE.Vector3, time: number): THREE.Vector3 | null {
  const from = trap.closedEnd;
  const key = trap.tug > 0.001 ? "" : `${from.x.toFixed(2)},${from.y.toFixed(2)},${from.z.toFixed(2)}`;
  if (key && key === trap.ropeKey) return trap.surface;
  trap.ropeKey = key;
  const isUnderwater = from.y < 0;
  const guide: THREE.Vector3[] = [];
  let entry: THREE.Vector3 | null = null;
  if (isUnderwater) {
    // 물결(최대 약 9 cm) 위로 띄운다 — 낮으면 물결에 묻혀 줄이 끊겨 보인다
    const floatY = 0.1 * M;
    entry = new THREE.Vector3(from.x, floatY, from.z);
    const ground = (x: number, z: number) => Math.max(groundY(x / M, z / M) * M, 0) + 0.025 * M;
    const shore = new THREE.Vector3().lerpVectors(to, entry, 0.45);
    shore.y = ground(shore.x, shore.z);
    const foot = new THREE.Vector3().lerpVectors(to, entry, 0.12);
    foot.y = ground(foot.x, foot.z) + 0.05 * M;
    const onWater = new THREE.Vector3().lerpVectors(to, entry, 0.75);
    onWater.y = Math.max(ground(onWater.x, onWater.z), floatY);
    guide.push(from.clone(), entry.clone(), onWater, shore, foot, to.clone());
  } else {
    const mid = from.clone().lerp(to, 0.5);
    mid.y = Math.max(groundY(mid.x / M, mid.z / M) * M + 0.02 * M, Math.min(from.y, to.y) - 0.08 * M);
    guide.push(from.clone(), mid, to.clone());
  }
  const curve = new THREE.CatmullRomCurve3(guide);
  const side = scratch.side.subVectors(to, from).cross(UP).normalize();
  const points: THREE.Vector3[] = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    const point = curve.getPoint(t);
    if (trap.tug > 0.001) {
      const shake = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 5 + time * 48) * trap.tug * 0.05 * M;
      point.addScaledVector(side, shake);
      point.y += Math.abs(shake) * 0.4;
    }
    points.push(point);
  }
  trap.rope.geometry.dispose();
  trap.rope.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, 0.014 * M, 5, false);
  trap.surface = entry;
  return entry;
}
