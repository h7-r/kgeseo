/** 바닥 자리 + 높이 + Y축 회전 */
export interface DeskPose {
  x: number;
  z: number;
  height: number;
  rotation: number;
}

/** 모니터 기준 상대 자리(Leva 「키보드(공통)」·「마우스(공통)」 의 좌우·앞뒤·높이·회전) */
export interface MonitorOffset {
  side: number;
  forward: number;
  height: number;
  rotation: number;
}

/**
 * 모니터 기준 상대 좌표를 월드 좌표로 편다. 예전 PcSet 그룹 구조(바깥 [x,0,z]·rot → 안쪽 [좌우, 높이, 앞뒤])와
 * 같은 결과여야 한다. three 의 Y 회전: (lx, lz) → (lx·cos + lz·sin, −lx·sin + lz·cos)
 */
export function monitorRelativePose(monitor: DeskPose, offset: MonitorOffset): DeskPose {
  return {
    x: monitor.x + offset.side * Math.cos(monitor.rotation) + offset.forward * Math.sin(monitor.rotation),
    z: monitor.z - offset.side * Math.sin(monitor.rotation) + offset.forward * Math.cos(monitor.rotation),
    height: monitor.height + offset.height,
    rotation: monitor.rotation + offset.rotation,
  };
}
