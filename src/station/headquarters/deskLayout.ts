/** 책상 한 자리: [x, z, 회전, 가로길이, 세로길이, 높이] */
export type DeskSpot = [x: number, z: number, rotation: number, width: number, depth: number, height: number];

/**
 * 책상 5개 기본 자리(scale 2.2 에서 가로 4.14 / 깊이 1.99).
 * 나란히 붙이려면 중심 간격 = 붙는 방향의 책상 두께 — 세로 책상은 1.99, 1.5배 가로 책상은 6.21.
 */
export const DESK_SPOTS: DeskSpot[] = [
  [-11, -7.3, 0.0, 2.2, 1, 1],
  [-12, -2.5, 1.57, 1.7, 1, 1],
  [-9.4, -2.5, 1.57, 1.7, 1, 1],
  [2.7, -2.6, 0.0, 1.5, 1, 1],
  [7.1, -4.3, -1.57, 1.5, 1, 1],
];

/** 바닥 자리 + 높이 + Y축 회전 */
export interface DeskPose {
  x: number;
  z: number;
  height: number;
  rotation: number;
}

/** 모니터 기준 상대 자리(Leva 「키보드(공통)」·「마우스(공통)」 의 좌우·앞뒤·높이·회전) */
interface MonitorOffset {
  side: number;
  forward: number;
  height: number;
  rotation: number;
}

/**
 * 모니터 기준 상대 좌표를 월드 좌표로 편다. 모니터 그룹(바깥 [x,0,z]·rot) 안 [좌우, 높이, 앞뒤] 자리와 같다.
 * three 의 Y 회전: (lx, lz) → (lx·cos + lz·sin, −lx·sin + lz·cos)
 */
export function computeMonitorRelativePose(monitor: DeskPose, offset: MonitorOffset): DeskPose {
  return {
    x: monitor.x + offset.side * Math.cos(monitor.rotation) + offset.forward * Math.sin(monitor.rotation),
    z: monitor.z - offset.side * Math.sin(monitor.rotation) + offset.forward * Math.cos(monitor.rotation),
    height: monitor.height + offset.height,
    rotation: monitor.rotation + offset.rotation,
  };
}
