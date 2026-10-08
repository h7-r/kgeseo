import type { LatchSettings } from "@/props/padlock/LatchPlate";

// 차단기함 자물쇠의 걸쇠 두 장 — 소화전 자물쇠와 같은 비율에 함이 작은 만큼 길이만 줄인다.
// 원점이 큰 구멍 한가운데라 좌우·위아래·깊이만 맞추면 쇠막대 길에 얹힌다.
export const DOOR_LATCH: LatchSettings = {
  visible: true,
  x: 0,
  alignToShackle: false,
  y: 0,
  z: -0.03,
  rotationX: 0,
  rotationY: 10,
  rotationZ: -180,
  // 판이 작으면 화면에서 회색 얼룩 두 점으로 뭉갠다
  hole: 1.6,
  plateWidth: 3.6,
  thickness: 0.72,
  length: 4.6,
  wing: 3.4,
  screwCount: 2,
  screwOnWing: true,
  screwColor: "#5d6166",
  screwSize: 0.6,
  color: "#838689",
};
export const FRAME_LATCH: LatchSettings = {
  visible: true,
  x: 0.03,
  alignToShackle: false,
  y: 0,
  z: -0.03,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  // 자물쇠가 문짝 안쪽에 있어 틀쪽 판이 테두리에서 구멍까지 건너와야 꿴 것이 된다
  hole: 1.6,
  plateWidth: 3.6,
  thickness: 0.42,
  length: 18.0,
  wing: 0,
  screwCount: 2,
  screwOnWing: false,
  screwColor: "#5d6166",
  screwSize: 0.55,
  color: "#838689",
};
