/** 호미 자세 — 손에 쥔 자세와 땅을 찍는 호미질 열쇠 자세, 그리고 두 자세 사이를 잇는 움직임 */
import * as THREE from "three";

import { M } from "../units";
import { HOE_SCALE } from "./clamModels";

/** 호미질 세 번 — 진행도 중 날이 모래에 박히는 때 */
export const STRIKES = [0.24, 0.52, 0.8];
/**
 * 호미질 자세 — [진행도, 날 끝 높이(m), 몸 쪽으로 물러난 거리(m), 숙인 각(+면 날이 아래)].
 * 들어 올리고 → 치켜들고 → 찍고 → 몸 쪽으로 긁는다. 두 번.
 */
export const DIG_KEYS: [number, number, number, number][] = [
  [0.08, 0.3, 0.18, -0.35],
  [0.18, 0.38, 0.22, -0.55],
  [0.24, -0.03, 0, 0.95],
  [0.33, -0.02, 0.12, 0.6],
  [0.42, 0.3, 0.2, -0.35],
  [0.48, 0.38, 0.22, -0.55],
  [0.52, -0.04, 0.02, 0.95],
  [0.61, -0.02, 0.16, 0.6],
  [0.7, 0.3, 0.2, -0.35],
  [0.76, 0.38, 0.22, -0.55],
  [0.8, -0.05, 0.04, 0.95],
  [0.9, -0.02, 0.2, 0.6],
  [1, 0.02, 0.22, 0.35],
];
/** 호미 날 끝 — 모형 자기 좌표(미터). 날은 +z, 자루는 −z */
const HOE_TIP = new THREE.Vector3(0, 0.03, 0.15);

const X_AXIS = new THREE.Vector3(1, 0, 0);
export const Y_AXIS = new THREE.Vector3(0, 1, 0);
const scratch = {
  offset: new THREE.Vector3(),
  swing: new THREE.Quaternion(),
  tilt: new THREE.Quaternion(),
  euler: new THREE.Euler(0, 0, 0, "YXZ"),
  tip: new THREE.Vector3(),
  tipOffset: new THREE.Vector3(),
};

export const ease = (t: number) => THREE.MathUtils.smoothstep(t, 0, 1);

/** 손에 든 호미 — 화면 오른쪽 아래, 자루가 손 쪽 */
export function holdHoe(camera: THREE.Camera, position: THREE.Vector3, quaternion: THREE.Quaternion) {
  scratch.offset.set(0.3, -0.3, -0.62).multiplyScalar(M).applyQuaternion(camera.quaternion);
  position.copy(camera.position).add(scratch.offset);
  quaternion
    .copy(camera.quaternion)
    .multiply(scratch.swing.setFromAxisAngle(Y_AXIS, Math.PI))
    .multiply(scratch.tilt.setFromAxisAngle(X_AXIS, 0.5));
}

/**
 * 땅을 찍는 호미 자세 — 날 끝이 구덩이 자리에 오도록 몸통을 거꾸로 맞춘다.
 * toPlayer: 구덩이에서 플레이어 쪽 수평 방향
 */
export function digPose(
  spot: THREE.Vector3,
  toPlayer: THREE.Vector3,
  [, height, back, pitch]: [number, number, number, number],
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
) {
  const yaw = Math.atan2(-toPlayer.x, -toPlayer.z); // 날이 플레이어 반대쪽(구덩이)을 본다
  quaternion.setFromEuler(scratch.euler.set(pitch, yaw, 0));
  const tip = scratch.tip.copy(spot).addScaledVector(toPlayer, back * M);
  tip.y += height * M;
  position.copy(tip).sub(
    scratch.tipOffset
      .copy(HOE_TIP)
      .applyQuaternion(quaternion)
      .multiplyScalar(M * HOE_SCALE),
  );
}

/** 진행도 p 의 호미질 자세 — 열쇠 자세 사이를 부드럽게 */
export function digKeyAt(p: number): [number, number, number, number] {
  for (let k = 1; k < DIG_KEYS.length; k++) {
    const [p1] = DIG_KEYS[k];
    if (p > p1) continue;
    const a = DIG_KEYS[k - 1];
    const b = DIG_KEYS[k];
    const t = ease((p - a[0]) / (b[0] - a[0]));
    return [p, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  return DIG_KEYS[DIG_KEYS.length - 1];
}

/** 움직임 하나 — 진행도(음수면 쉼)와 시작 자세 */
export function createMove() {
  return { t: -1, fromPosition: new THREE.Vector3(), fromQuaternion: new THREE.Quaternion() };
}
export type Move = ReturnType<typeof createMove>;

export function startMove(move: Move, object: THREE.Object3D) {
  move.t = 0;
  move.fromPosition.copy(object.position);
  move.fromQuaternion.copy(object.quaternion);
}
