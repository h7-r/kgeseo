import type { RefObject } from "react";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import type { AvatarLink } from "@/engine/avatarLink";
import { useSavedControls } from "@/engine/leva/savedControls";
import { aimedPosition } from "@/lobby/interactions";
import { itemSizes } from "@/lobby/placement";

// 손 자세 — 손붙이기 Leva 값과, 손·품 앵커가 갈 자리 계산.

/** 손붙이기의 Leva 폴더 6개. 폴더 이름이 저장 열쇠라 순서·이름을 그대로 둔다. */
export function useHandControls() {
  // 손목 뼈 축은 모델마다 달라 코드로 찍으면 손등에 얹히거나 팔에 박힌다 — 화면을 보며 맞춘다.
  const grip = useSavedControls("손에 쥐기", {
    offsetX: { value: 0, min: -0.6, max: 0.6, step: 0.005, label: "밀기x" },
    offsetY: { value: 0, min: -0.6, max: 0.6, step: 0.005, label: "밀기y" },
    offsetZ: { value: 0, min: -0.6, max: 0.6, step: 0.005, label: "밀기z" },
    rotateX: { value: 0, min: -180, max: 180, step: 1, label: "돌리기x" },
    rotateY: { value: 0, min: -180, max: 180, step: 1, label: "돌리기y" },
    rotateZ: { value: 0, min: -180, max: 180, step: 1, label: "돌리기z" },
    // 0 이면 손 모양이 안 바뀌고 1 이면 쥠표의 물건별 세기 그대로. 평소 손(0.6)보다 작은 값이면 오히려 펴진다.
    fistBlend: { value: 1, min: 0, max: 1, step: 0.05, label: "주먹섞기" },
    // 쥠표에 handRotation 이 있는 물건만 손목이 돈다. 컵·캔·모자는 손바닥이 옆을 봐야 쥔 것으로 보인다.
    wristMatch: { value: 1, min: 0, max: 1, step: 0.05, label: "손목맞춤" },
    // 리그의 물건 전용 뼈(prop_r)에 매단다. 끄면 손뼈 + 주먹중심 보정으로 돌아간다.
    useSocket: { value: true, label: "소켓쓰기" },
  });
  // 상자를 한 손에 매달면 얼굴을 통째로 가려 품에 안는다. 끄면 한 손으로 든다.
  const hug = useSavedControls("품 안기", {
    enabled: { value: true, label: "켜기" },
    forward: { value: 0.34, min: -0.2, max: 1, step: 0.01, label: "앞" },
    // 0 이면 딱 붙는다(살짝 파묻히는 게 자연스럽다)
    margin: { value: 0.04, min: -0.1, max: 0.4, step: 0.01, label: "여유" },
    down: { value: 0.46, min: -0.5, max: 1.5, step: 0.01, label: "아래" },
    side: { value: 0, min: -0.5, max: 0.5, step: 0.01, label: "옆" },
    tilt: { value: 0, min: -60, max: 60, step: 1, label: "기울기" },
  });
  // 어깨 기준 방향 + 팔 길이 비율. 절대값이면 체형을 바꿀 때마다 팔이 쭉 펴지거나 몸에 박힌다.
  // 팔 길이의 55~60% 쯤이어야 팔꿈치가 자연스럽게 굽는다.
  const holdPose = useSavedControls("손 자리", {
    reachRatio: { value: 0.56, min: 0.2, max: 1, step: 0.01, label: "뻗음비" },
    forward: { value: 1, min: 0, max: 2, step: 0.05, label: "앞" },
    side: { value: 0.45, min: -1.5, max: 1.5, step: 0.05, label: "옆" },
    down: { value: 0.65, min: -1, max: 2, step: 0.05, label: "아래" },
    // [E] 때 비율을 더한다
    extraReach: { value: 0.28, min: 0, max: 0.6, step: 0.01, label: "더뻗기" },
  });
  const reach = useSavedControls("팔 뻗기", { enabled: { value: true, label: "켜기" } });
  // 1인칭에서도 같은 아바타를 머리만 접고 그려 제 손으로 쥔다. 손 자리는 카메라 기준이라 고개를 숙여도 화면에 머문다.
  // 손이 눈에서 너무 가까우면 팔뚝이 화면을 덮는다 — 값은 화면으로 잡았다.
  const firstPerson = useSavedControls("1인칭 손", {
    enabled: { value: true, label: "켜기" },
    forward: { value: 0.9, min: 0.2, max: 1.2, step: 0.01, label: "앞" },
    side: { value: 0.34, min: -0.6, max: 0.8, step: 0.01, label: "옆" },
    down: { value: 0.42, min: -0.3, max: 1, step: 0.01, label: "아래" },
    // 1 이면 시선을 그대로, 0 이면 수평만 따른다
    pitchFollow: { value: 0.6, min: 0, max: 1, step: 0.05, label: "피치따름" },
    // [E] 로 뻗을 때 팔 길이 상한(3인칭은 0.92 고정)
    reachLimit: { value: 0.72, min: 0.3, max: 0.95, step: 0.01, label: "뻗기제한" },
    // 품 물건이 1인칭에서 오는 자리 — 화면 가운데 아래
    hugForward: { value: 0.55, min: 0.1, max: 1.2, step: 0.01, label: "품앞" },
    hugDown: { value: 0.55, min: -0.3, max: 1, step: 0.01, label: "품아래" },
  });
  // 붐 손잡이(미터). 열쇠가 thirdPersonConfig 필드 이름과 같아야 한다 — 매 프레임 Object.assign 한다.
  const thirdPerson = useSavedControls("3인칭 시점", {
    enabled: { value: true, label: "켬" },
    // 복도 폭이 3.3 m 라 이보다 멀면 늘 벽에 닿는다
    distance: { value: 2.0, min: 0.6, max: 5, step: 0.05, label: "거리" },
    pivotHeight: { value: 0.22, min: -0.3, max: 1.2, step: 0.01, label: "피벗높이" },
    shoulderOffset: { value: 0.3, min: -1, max: 1, step: 0.01, label: "어깨옆" },
    // 0 이면 카메라 근평면 모서리가 벽을 뚫는다
    boomRadius: { value: 0.16, min: 0, max: 0.6, step: 0.01, label: "붐반경" },
    extendSpeed: { value: 3.2, min: 0.5, max: 20, step: 0.1, label: "펴짐속도" },
    pullWhenLookingDown: { value: 0.45, min: 0, max: 0.9, step: 0.01, label: "내려볼때당김" },
    pullWhenLookingUp: { value: 0.2, min: 0, max: 0.9, step: 0.01, label: "올려볼때당김" },
    fov: { value: 64, min: 0, max: 100, step: 1, label: "시야각" },
    fovSpeed: { value: 4, min: 0.5, max: 20, step: 0.5, label: "시야속도" },
  });
  return { grip, hug, holdPose, reach, firstPerson, thirdPerson };
}

/** 「품 안기」 값. 길이는 전부 팔 길이 배다. */
type HugValues = ReturnType<typeof useHandControls>["hug"];

// 아바타가 가슴을 재서 알려 주기 전 값. 걷기 캡슐(0.6)은 어깨 폭까지 포함해 팔이 활짝 벌어진다.
const DEFAULT_BODY_RADIUS = 0.46;

const chestEuler = new THREE.Euler();
const tiltQuaternion = new THREE.Quaternion();
const bodyRight = new THREE.Vector3(1, 0, 0);

/**
 * 품에 안는 물건이 붙을 가슴 앞 자리.
 * 두 어깨 중앙 기준 — 골반이면 키 큰 체형에서 배꼽까지 내려가고, 한쪽 어깨면 늘 치우친다.
 * 길이를 팔 길이 배로 두어야 체형 슬라이더를 바꿔도 상자가 가슴에 박히거나 뜨지 않는다.
 * @param itemHalfDepth 물건의 몸 쪽 반깊이. 상수 앞 거리로는 두꺼운 물건이 몸에 박힌다.
 */
export function chestAnchor(
  st: AvatarLink,
  hug: HugValues,
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
