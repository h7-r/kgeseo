import { exposeDevHook } from "@/debug/devHooks";

/** 왼쪽 벽(x = HEADQUARTERS_MIN_X)의 구멍과 그 뒤 비밀 복도 경계. */
export interface PassageState {
  /** 0 = 닫힘, 1 = 완전히 열림 */
  open: number;
  /** 방↔복도 구멍의 중심 z */
  doorZ: number;
  doorWidth: number;
  /** 복도 바깥벽 x */
  corridorMinX: number;
  corridorMinZ: number;
  corridorMaxZ: number;
  /** 개발용 — 문 판정을 건너뛰고 방·복도를 자유롭게 오간다 */
  freeRoam: boolean;
}

// 매 프레임 이동 계산이 읽으므로 React state 대신 모듈 상자에 둔다. Leva 값이 바뀔 때만 set 한다.
// 첫 값은 Leva 「비밀 복도」 코드 기본값과 같아야 한다 — Scene effect 가 값을 넣기 전 첫 프레임에도 경계를 자른다.
let current: PassageState = {
  open: 1,
  doorZ: 4,
  doorWidth: 3.6,
  corridorMinX: -31,
  corridorMinZ: -60,
  corridorMaxZ: 25.5,
  freeRoam: false,
};

export const passage = {
  get: (): PassageState => current,
  set: (partial: Partial<PassageState>) => {
    current = { ...current, ...partial };
  },
};

// 해제 > 진입 이어야 한다. 같으면 문 앞에 내린 순간 다시 빨려 들어간다.
/** 이만큼 다가오면 기차 문이 열리기 시작한다(연출). */
export const DOOR_OPEN_DISTANCE = 6.5;
/** 이 안이면 문 안으로 들어섰다고 보고 씬을 바꾼다. */
export const DOOR_ENTER_DISTANCE = 2.0;
/** 기차에서 내린 뒤 이만큼 멀어져야 다시 들어갈 수 있다. */
export const DOOR_UNLOCK_DISTANCE = 3.4;

/** onNear 로 오가는 상호작용 지점 이름. "" 은 근처에 아무것도 없음. */
export const NEAR_TARGET = {
  none: "",
  /** 문 안으로 들어섰다 — 키 없이 넘어간다 */
  trainEntrance: "trainEntrance",
  /** 문 앞 — [E] 로 탄다 */
  train: "train",
  /** 객차 안 출구 앞 */
  trainExit: "trainExit",
} as const;

export type NearTarget = (typeof NEAR_TARGET)[keyof typeof NEAR_TARGET];

exposeDevHook("passage", passage);
