/** 책상 한 자리: [x, z, 회전, 가로길이, 세로길이, 높이] — Leva 로 맞춘 값을 고정해 둔 것 */
export type DeskSpot = [x: number, z: number, rotation: number, width: number, depth: number, height: number];

/**
 * 책상 5개 기본 자리(scale 2.2 실측: 가로 4.14 / 깊이 1.99).
 * 나란히 붙이려면 중심 간격 = 붙는 방향의 책상 두께 — 세로 책상은 1.99, 1.5배 가로 책상은 6.21.
 */
export const DESK_SPOTS: DeskSpot[] = [
  [-11, -7.3, 0.0, 2.2, 1, 1],
  [-12, -2.5, 1.57, 1.7, 1, 1],
  [-9.4, -2.5, 1.57, 1.7, 1, 1],
  [2.7, -2.6, 0.0, 1.5, 1, 1],
  [7.1, -4.3, -1.57, 1.5, 1, 1],
];
