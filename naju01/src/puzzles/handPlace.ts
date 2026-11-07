/**
 * 손에 든 물건이 놓이는 자리 — 눈을 따라 화면 오른쪽 아래. 퍼즐이 그 물건을 어떤 자리로 내밀게 할 수 있다(handReach).
 * 손에 든 것을 그리는 쪽(WorldItems)과, 그 끝에 불꽃 같은 것을 다는 퍼즐이 같이 쓴다. 단위는 유닛.
 */
import * as THREE from "three";

import { M } from "./units";

/** 손에 든 물건 자리(미터) — 화면 오른쪽 아래, 눈보다 아래 */
const HAND_OFFSET = { forward: 0.8, side: 0.3, down: 0.36 };
/** 손에 든 물건 배율 — 눈 바로 앞이라 실물 크기면 화면을 가린다 */
export const HAND_SCALE = 0.7;
const handForward = new THREE.Vector3();
const handSide = new THREE.Vector3();
/**
 * 손에 든 것을 내미는 자리 — 퍼즐이 건다(꺼진 횃불에 대는 관솔불). amount 0~1 만큼 손 자리에서 그 자리(유닛)로 간다
 */
export const handReach = { target: new THREE.Vector3(), amount: 0 };

/** 손에 든 물건의 밑동 자리(유닛) — 눈을 따라 화면 오른쪽 아래, 내밀고 있으면 그만큼 나아간 자리 */
export function handItemAt(camera: THREE.Camera, out: THREE.Vector3) {
  camera.getWorldDirection(handForward);
  handSide.crossVectors(handForward, camera.up).normalize();
  out
    .copy(camera.position)
    .addScaledVector(handForward, HAND_OFFSET.forward * M)
    .addScaledVector(handSide, HAND_OFFSET.side * M)
    .addScaledVector(camera.up, -HAND_OFFSET.down * M);
  return handReach.amount > 0 ? out.lerp(handReach.target, handReach.amount) : out;
}
