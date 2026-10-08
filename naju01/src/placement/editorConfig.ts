// 편집기 여러 조각이 같이 쓰는 설정값과 선택 꼴.

import { MESH_NAMES } from "../plan/meshNames";
import { CORE } from "../plan/sitePlan";

export const ROTATION_STEP = Math.PI / 12; // 15°
export const NUDGE_STEP = 0.25; // m — Shift 를 누르면 4 배

// 광선이 「땅」으로 받아 주는 메시. 무대 밖에 놓으려면 원경 들판도 맞혀야 한다.
export const GROUND_MESHES: string[] = [
  MESH_NAMES.ground,
  MESH_NAMES.path,
  MESH_NAMES.slope,
  MESH_NAMES.cliffFace,
  MESH_NAMES.cliffBoulders,
  MESH_NAMES.zoneSides,
  MESH_NAMES.distantFields,
  MESH_NAMES.distantFarFields,
];
// 여기 맞았으면 그 점의 높이를 그대로 쓴다 — 코어 밖은 지표가 값을 안 갖고 있어 원경 나무가 땅에 박힌다
export const OUTER_GROUND = new Set<string>([MESH_NAMES.distantFields, MESH_NAMES.distantFarFields]);

// 못 고르는 것을 눌렀을 때 이유를 말해 준다. 조용하면 편집기가 고장 난 줄 안다.
export const UNPICKABLE: Record<string, string> = {
  [MESH_NAMES.blockerRock]: "차단물 바위 — 도면 §4 가 시야를 막으려고 세운 것이다. 옮기면 V3 에서 사건 현장이 보인다",
  [MESH_NAMES.zoneSides]: "구역 옆구리 — 대지를 깎은 면이다. 걷는 높이와 한 몸이라 못 옮긴다",
  [MESH_NAMES.ground]: "땅 — 걷는 바닥 그 자체다",
  [MESH_NAMES.path]: "길 바닥 — 도면이 정한 통로다(T1~T4 길이·경사가 여기에 걸려 있다)",
  [MESH_NAMES.slope]: "길을 받치는 흙비탈 — 길 바닥과 한 몸이다",
  [MESH_NAMES.cliffFace]: "절벽면 — 도면이 정한 벼랑이다",
  [MESH_NAMES.grass]: "풀 — 한 장으로 합쳐 그린다(11만 삼각형이라 하나씩 나누면 느려진다)",
};
// 하늘·물·원경은 눌러도 알릴 것이 없다
export const SILENT_MESHES = /^(river|sky|distant)/;

// 부감 — 걸으면서 배치하면 전체가 안 보여 한쪽으로 쏠린 걸 뒤늦게 안다
export const OVERVIEW = {
  height: 22, // m
  heightRange: [4, 90] as const,
  pitch: -1.05, // ≈ -60°. 수직이면 방향 감각이 사라진다
  panSpeed: 14, // m/s, Shift 3 배
};

// 무대 밖 원경(코어에서 사방 250 m)까지만 연다 — 끝없이 두면 1 km 밖으로 밀려 돌아올 길을 잃는다
export const EDIT_BOUNDS = {
  x: [CORE.x[0] - 250, CORE.x[1] + 250],
  z: [CORE.z[0] - 250, CORE.z[1] + 250],
};

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
// 긴 프레임 하나에 시점이 몇 바퀴씩 돌지 않게 dt 를 50 ms 로 물린다
export const clampDelta = (dt: number) => Math.min(dt, 0.05);

export type Vec3Tuple = [number, number, number];

export interface Selection {
  groupId: string;
  id: number;
  x: number;
  y: number;
  z: number;
  size: number;
  rotation: number;
  tilt: number;
  tilt2: number;
  widthRatio: number;
  depthRatio: number;
  shapeIndex?: number;
  color?: number;
  /** 유닛 단위 국소 상자(모양 기준, 인스턴스 크기를 곱한 것) */
  box?: { size: Vec3Tuple; center: Vec3Tuple };
}
