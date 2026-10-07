import type { RefObject } from "react";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { aimedPosition } from "@/lobby/interactions";
import { itemSizes } from "@/lobby/placement";

import type { AvatarLink } from "@/engine/avatarLink";

/** Leva 「품 안기」 중 가슴 앵커가 읽는 값. 길이는 전부 팔 길이 배다. */
export interface HugPose {
  /** 물건 두께를 모를 때만 쓰는 앞 거리 */
  forward: number;
  /** 물건 뒷면과 가슴 사이 틈 */
  margin: number;
  down: number;
  side: number;
  /** 몸 오른쪽 축으로 눕히는 각(도) */
  tilt: number;
}

// 아바타가 가슴을 재서 알려 주기 전 값. 걷기 캡슐(0.6)은 어깨 폭까지 포함해 팔이 활짝 벌어진다.
const DEFAULT_BODY_RADIUS = 0.46;

const chestEuler = new THREE.Euler();
const tiltQuaternion = new THREE.Quaternion();
const bodyRight = new THREE.Vector3(1, 0, 0);

/**
 * 품에 안는 물건이 붙을 가슴 앞 자리.
 * 두 어깨 중앙 기준 — 골반이면 키 큰 체형에서 배꼽까지 내려가고, 한쪽 어깨면 늘 치우친다.
 * 길이를 팔 길이 배로 두어야 체형 슬라이더를 바꿔도 상자가 가슴에 박히거나 뜨지 않는다.
 * @param itemHalfDepth 물건의 몸 쪽 반깊이. 상수 앞 거리로는 두꺼운 노트북이 몸 한가운데에 박혔다.
 */
export function chestAnchor(
  st: AvatarLink,
  hug: HugPose,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion | null,
  itemHalfDepth = 0,
): boolean {
  const right = st.shoulderPosition;
  const left = st.leftShoulderPosition;
  const arm = st.armLength ?? 0;
  if (!right || !left || !(arm > 0)) return false;
  const facing = st.facing ?? 0;
  const torso = st.torsoHalfDepth ?? 0;
  const chest = torso > 0 ? torso : DEFAULT_BODY_RADIUS;
  // 앵커는 물건 한가운데라, 뒷면이 가슴 앞면 밖에 있으려면 반깊이만큼 더 나가야 한다.
  const forwardRatio = itemHalfDepth > 0 ? (chest + itemHalfDepth + hug.margin) / arm : hug.forward;
  const forwardX = Math.sin(facing);
  const forwardZ = Math.cos(facing);
  const sideX = Math.cos(facing);
  const sideZ = -Math.sin(facing);
  position.set(
    (left.x + right.x) / 2 + forwardX * forwardRatio * arm + sideX * hug.side * arm,
    (left.y + right.y) / 2 - hug.down * arm,
    (left.z + right.z) / 2 + forwardZ * forwardRatio * arm + sideZ * hug.side * arm,
  );
  if (quaternion) {
    quaternion.setFromEuler(chestEuler.set(0, facing, 0));
    // yaw 를 먼저 건 뒤 오른쪽에 곱하므로 (1,0,0) 은 몸 기준 오른쪽이다.
    if (hug.tilt) {
      quaternion.multiply(tiltQuaternion.setFromAxisAngle(bodyRight, (hug.tilt * Math.PI) / 180));
    }
  }
  return true;
}

const shoulder = new THREE.Vector3();

/**
 * [E] 로 만지는 물건 쪽 손 자리를 out 에 적는다. 팔 길이를 넘기면 IK 가 팔을 막대처럼 펴므로 자르고,
 * 손이 물건을 뚫으면 통과한 것으로 보여 겉면 조금 앞에서 멈춘다.
 * @param maxRatio 팔 길이 대비 상한. 1인칭은 어깨가 카메라 바로 밑이라 다 뻗으면 소매가 화면을 덮는다.
 */
export function reachTarget(
  st: AvatarLink,
  target: RefObject<Vector3Tuple | null>,
  out: THREE.Vector3,
  maxRatio = 0.92,
): boolean {
  // 뻗기 시작한 순간의 대상을 붙잡는다 — 고개를 조금만 돌려도 겨냥이 풀려 손이 딸꾹인다.
  if (!target.current) target.current = aimedPosition();
  const p = target.current;
  if (!p) return false;
  const shoulderPoint = st.shoulderPosition;
  const arm = st.armLength ?? 0;
  if (!shoulderPoint || !(arm > 0)) return false;
  shoulder.set(shoulderPoint.x, shoulderPoint.y, shoulderPoint.z);
  out.set(p[0], p[1], p[2]).sub(shoulder);
  const d = out.length();
  if (d < 1e-4) return false;
  const reach = Math.min(d - 0.12, arm * maxRatio);
  if (reach < 0.15) return false; // 너무 가깝다 — 평소 자세가 낫다
  out.multiplyScalar(reach / d).add(shoulder);
  return true;
}

/**
 * 든 물건이 몸통을 뚫지 않게 손을 수평으로 비킨다. 몸은 걷기 판정과 같은 세로 기둥으로 본다.
 * 위아래로 밀면 물건이 떠 보인다 — 사람도 큰 걸 들면 옆으로 벌린다.
 * 물건은 쥠점이 손에 오게 놓이므로 반폭은 쥠점에서 상자 모서리까지의 수평 거리다.
 */
export function pushClearOfBody(
  st: AvatarLink,
  itemId: string | null | undefined,
  position: THREE.Vector3,
  gripPoint: Vector3Tuple | null | undefined,
) {
  const size = itemId ? itemSizes.get(itemId) : null;
  const halfX = size?.trueHalfX ?? size?.halfX ?? 0.15;
  const halfZ = size?.trueHalfZ ?? size?.halfZ ?? 0.15;
  const [gx, , gz] = gripPoint ?? [0, 0, 0];
  const halfWidth = Math.hypot(Math.abs(gx) + halfX, Math.abs(gz) + halfZ);
  const bodyX = st.position.x;
  const bodyZ = st.position.z;
  const dx = position.x - bodyX;
  const dz = position.z - bodyZ;
  const d = Math.hypot(dx, dz);
  const torso = st.torsoHalfDepth ?? 0;
  const bodyRadius = torso > 0 ? torso : DEFAULT_BODY_RADIUS;
  const needed = bodyRadius + halfWidth;
  if (d >= needed) return;
  if (d < 1e-4) {
    // 손이 축 위에 정확히 있다 — 밀 방향이 없어 몸 오른쪽으로 민다.
    const facing = st.facing ?? 0;
    position.x = bodyX + Math.cos(facing) * needed;
    position.z = bodyZ - Math.sin(facing) * needed;
    return;
  }
  position.x = bodyX + (dx / d) * needed;
  position.z = bodyZ + (dz / d) * needed;
}
