import type * as THREE from "three";

// 갓 입구와 빛 방향은 GLB 에서 잰 값이다. 눈대중이면 빛이 갓 밖으로 새거나 갓 안에 파묻힌다.
// 모델은 높이 1.0 으로 정규화돼 있어 scale 이 곧 램프 높이(유닛)다.

export const DESK_LAMP_URL = "/models/lamp.glb";
/** 갓 입구 중심 */
export const DESK_LAMP_MOUTH: THREE.Vector3Tuple = [-0.2378, 0.802, -0.0627];
/** 빛이 나가는 방향(수직에서 44.7°) */
export const DESK_LAMP_AXIS: THREE.Vector3Tuple = [-0.703, -0.7112, 0.0];

/** 장스탠드 — 같은 모델의 기둥만 4배로 늘인 변형이라 갓 입구를 다시 쟀다. */
export const FLOOR_LAMP_URL = "/models/lamp_floor.glb";
export const FLOOR_LAMP_MOUTH: THREE.Vector3Tuple = [-0.1013, 0.9157, -0.0267];
export const FLOOR_LAMP_AXIS: THREE.Vector3Tuple = [-0.703, -0.7112, 0.0];
