import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

/** 손뼈 기준 쥔 자리 보정. 뼈 축이 모델마다 달라 Leva 「손에 쥐기」 가 매 프레임 적는다. */
export interface GripOffset {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export interface PlayerView {
  eye: THREE.Vector3;
  isThirdPerson: boolean;
  ready: boolean;
  hand: THREE.Object3D | null;
  palm: THREE.Vector3 | null;
  gripSocket: THREE.Object3D | null;
  bodyYaw: number;
  grip: GripOffset;
  chest: { enabled: boolean; ready: boolean; position: THREE.Vector3; quaternion: THREE.Quaternion };
  twoHands: { ready: boolean; left: THREE.Vector3; right: THREE.Vector3 };
  pickedFrom: { ready: boolean; position: THREE.Vector3; yaw: number };
  firstPersonHands: boolean;
}

/**
 * 지금 플레이어가 서 있는 자리와 몸·손 상태. 3인칭 카메라는 캐릭터 뒤에 떨어져 있어,
 * 손이 닿는지는 카메라가 아니라 이 자리로 잰다. 쓰는 쪽이 여럿이라 매 프레임 그 자리에서 고쳐 쓴다.
 */
export const playerView: PlayerView = {
  eye: new THREE.Vector3(),
  isThirdPerson: false,
  /** 아직 한 프레임도 안 돌았으면 false — 그동안은 카메라를 쓴다 */
  ready: false,
  /** 오른손 뼈. 아바타가 naju01 쪽에 있어 손붙이기가 매 프레임 옮겨 적는다. */
  hand: null,
  /** 손목 → 주먹 한가운데(손뼈 로컬). 뼈 원점이 손목이라 그대로 두면 팔목에 붙은 것처럼 보인다. 리그의 사실이라 Leva 로 안 뺀다. */
  palm: null,
  /** 물건 전용 소켓 뼈(prop_r). 손을 따라다니는 고정 부착점이라 손목·뒤집기 보정이 필요 없다. */
  gripSocket: null,
  /** 몸이 바라보는 각(yaw). 든 물건을 몸에 맞춰 세우는 기준. */
  bodyYaw: 0,
  grip: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  /** 품에 안는 물건(상자)이 붙을 가슴 앞 자리. 손뼈를 따르면 걸을 때 팔 스윙대로 휘둘린다. */
  chest: {
    /** Leva 「품 안기 › 켜기」. 꺼져 있으면 손뼈에 붙는다 */
    enabled: false,
    ready: false,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  },
  /** 두 손 물건이 알려 주는 두 손 자리(세계). 다음 프레임 손붙이기가 양팔 IK 목표로 쓴다. */
  twoHands: {
    ready: false,
    left: new THREE.Vector3(),
    right: new THREE.Vector3(),
  },
  /** 방금 집은 물건이 놓여 있던 자리. 손이 닿은 뒤에 붙이려고 남긴다 — 붙은 뒤에도 값이 남으니 ready 로 가려 읽는다. */
  pickedFrom: { ready: false, position: new THREE.Vector3(), yaw: 0 },
  /** 이번 프레임 1인칭에서 아바타 몸(머리 접고)을 그릴지. 물건을 들거나 뻗는 동안만 켠다. */
  firstPersonHands: false,
};

exposeDevHook("view", playerView);
exposeDevHook("playerPosition", playerView);

// 손이 한 번 나가 줘야 동전·선·밸브가 혼자 움직이지 않고 「내가 한 일」 이 된다.
// 대상마다 IK 를 풀면 팔이 꺾이기 쉬워, 마주 보고 앞으로 뻗는 한 자세로 한다.
const reach = { start: 0, duration: 0.6 };

/** [E] 로 무언가를 만졌다 — 팔을 한 번 뻗는다. */
export function startReach(duration = 0.6) {
  reach.start = performance.now();
  reach.duration = duration;
}

// [E] 는 마우스 잠금 안에서만 먹어 헤드리스로는 확인할 길이 없다.
exposeDevHook("reach", startReach);

/** 지금 얼마나 뻗었나 0~1. 빠르게 나갔다 천천히 돌아온다. */
export function reachAmount(): number {
  if (!reach.start) return 0;
  const t = (performance.now() - reach.start) / 1000;
  if (t >= reach.duration) return 0;
  const outTime = 0.16;
  if (t < outTime) return t / outTime;
  const u = (t - outTime) / Math.max(0.01, reach.duration - outTime);
  return 1 - u * u;
}
