// 플레이어 상자 — 이동이 몸 상태를 적고, 아바타(naju01)가 그걸 읽어 몸을 놓은 뒤 손뼈·어깨 자리·팔 길이를
// 되적는다. 본편 손붙이기는 그 값으로 손 목표를 정해 다시 적는다. 두 패키지가 서로 import 하지 않고
// 이 상자 하나로만 이어지도록 engine 에 둔다.
import type * as THREE from "three";

import type { PlayerMotionState } from "@/engine/movement/useMovement";

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionValues {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** 팔꿈치가 빠지는 쪽(방향 성분, 거리 아님). 꺼져 있으면 옛 부호 시험 IK 로 돈다. */
export interface ArmPole {
  enabled: boolean;
  back: number;
  down: number;
  outward: number;
  /** 클립 팔꿈치 → 고정 폴 쪽으로 섞는 양(IK 세기와 곱한다) */
  weight: number;
}

export interface AvatarLink extends PlayerMotionState {
  /** 펀치 — 바뀔 때마다 attackMotion 클립을 한 번 튼다 */
  attackSerial?: number;
  attackMotion?: string;

  // ── 아바타가 적는다 ──
  rightHand?: THREE.Object3D | null;
  leftHand?: THREE.Object3D | null;
  /** 손목 → 주먹 한가운데(손뼈 로컬) */
  rightPalm?: THREE.Vector3 | null;
  leftPalm?: THREE.Vector3 | null;
  /** 물건 전용 소켓 뼈(prop_r / prop_l) */
  rightGripSocket?: THREE.Object3D | null;
  leftGripSocket?: THREE.Object3D | null;
  shoulderPosition?: WorldPoint | null;
  leftShoulderPosition?: WorldPoint | null;
  shoulderHeight?: number;
  armLength?: number;
  /** 아바타가 잰 가슴 반두께(세계 배율). 못 쟀으면 null — 한 번 재면 다시 안 잰다 */
  torsoHalfDepth?: number | null;

  // ── 게임(손붙이기)이 적는다 ──
  /** 오른팔 IK 세기 0~1 */
  handIk?: number;
  handTarget?: WorldPoint | null;
  leftHandIk?: number;
  leftHandTarget?: WorldPoint | null;
  /** 손가락을 감는 정도(절대값 — 평소보다 작으면 손이 펴진다) */
  gripStrength?: number;
  /** 평소 손 → 쥔 손 섞는 양 */
  gripBlend?: number;
  /** 손목 목표 회전(세계) */
  handRotation?: QuaternionValues | null;
  leftHandRotation?: QuaternionValues | null;
  handRotationWeight?: number;
  /** 1인칭에서 몸만 그릴지(물건을 들거나 [E] 로 뻗는 동안) */
  firstPersonHands?: boolean;
  /** 팔꿈치 폴. 없으면 아바타 기본값(꺼짐) */
  armPole?: ArmPole | null;
}
