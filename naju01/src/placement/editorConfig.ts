// 통합 편집 모드의 설정값.

import { MESH_NAMES } from "../plan/meshNames";

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

// 못 고르는 것을 눌렀을 때 이유를 말해 준다. 조용하면 편집기가 고장 난 줄 안다.
export const UNPICKABLE_REASONS: Record<string, string> = {
  [MESH_NAMES.blockerRock]: "차단물 바위 — 도면 §4 가 시야를 막으려고 세운 것이다. 옮기면 V3 에서 사건 현장이 보인다",
  [MESH_NAMES.zoneSides]: "구역 옆구리 — 대지를 깎은 면이다. 걷는 높이와 한 몸이라 못 옮긴다",
  [MESH_NAMES.ground]: "땅 — 걷는 바닥 그 자체다",
  [MESH_NAMES.path]: "길 바닥 — 도면이 정한 통로다(T1~T4 길이·경사가 여기에 걸려 있다)",
  [MESH_NAMES.slope]: "길을 받치는 흙비탈 — 길 바닥과 한 몸이다",
  [MESH_NAMES.cliffFace]: "절벽면 — 도면이 정한 벼랑이다",
  [MESH_NAMES.grass]: "풀 — 한 장으로 합쳐 그린다(11만 삼각형이라 하나씩 나누면 느려진다)",
};

// 부감 — 걸으면서 배치하면 전체가 안 보여 한쪽으로 쏠린 걸 뒤늦게 안다
export const OVERVIEW_CAMERA = {
  height: 22, // m
  heightRange: [4, 90] as const,
  pitch: -1.05, // ≈ -60°. 수직이면 방향 감각이 사라진다
  panSpeed: 14, // m/s, Shift 3 배
};
