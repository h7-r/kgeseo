import * as THREE from 'three'

// 수평(XZ) 평면 기준 회피 도구. y는 무시한다.
// 지금은 플레이어만 원형 장애물로 다루지만, 벽·장애물도 같은 형태로 넘기면 재사용할 수 있다.
export interface CircleXZ {
  x: number
  z: number
  radius: number
}

// 우회 방향: +1 = XZ 각도 증가 방향, -1 = 감소 방향, 0 = 우회 안 함
export type DetourSide = 1 | -1 | 0

const TWO_PI = Math.PI * 2

function wrapPositive(angle: number): number {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}

// 선분 from→to가 원 내부를 지나는지 검사
export function segmentHitsCircleXZ(
  from: THREE.Vector3,
  to: THREE.Vector3,
  circle: CircleXZ,
): boolean {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const lengthSq = dx * dx + dz * dz
  let t = lengthSq > 0 ? ((circle.x - from.x) * dx + (circle.z - from.z) * dz) / lengthSq : 0
  t = Math.min(1, Math.max(0, t))
  const cx = from.x + dx * t - circle.x
  const cz = from.z + dz * t - circle.z
  return cx * cx + cz * cz < circle.radius * circle.radius
}

export interface DetourOptions {
  orbitRadius: number // 경유점을 놓는 원의 반경 (검사 반경보다 커야 함)
  lookahead: number // 접선 지점에서 더 앞으로 내다보는 각도 (rad)
  switchMargin: number // 반대쪽 경로가 이만큼(rad) 더 짧아야 방향을 바꾼다
}

// 직선 경로가 원과 교차하면 원 둘레의 경유점을 out에 기록하고 우회 방향을 돌려준다.
// 교차하지 않으면 out = goal, 반환값 0.
// previousSide를 유지해 목표가 정반대에 있을 때 좌우로 번갈아 바뀌지 않게 한다.
export function planDetourXZ(
  from: THREE.Vector3,
  goal: THREE.Vector3,
  circle: CircleXZ,
  previousSide: DetourSide,
  options: DetourOptions,
  out: THREE.Vector3,
): DetourSide {
  if (!segmentHitsCircleXZ(from, goal, circle)) {
    out.copy(goal)
    return 0
  }

  const fx = from.x - circle.x
  const fz = from.z - circle.z
  const fromAngle = Math.atan2(fz, fx)
  const goalAngle = Math.atan2(goal.z - circle.z, goal.x - circle.x)
  const positiveArc = wrapPositive(goalAngle - fromAngle)
  const arcFor = (side: 1 | -1) => (side === 1 ? positiveArc : TWO_PI - positiveArc)

  let side: 1 | -1
  if (previousSide === 0) {
    side = positiveArc <= Math.PI ? 1 : -1
  } else {
    side = previousSide
    if (arcFor(side) > Math.PI + options.switchMargin) side = side === 1 ? -1 : 1
  }

  // 원 밖에 있으면 접선 지점까지의 각도만큼 건너뛰어 불필요하게 원 쪽으로 붙지 않게 한다
  const distance = Math.hypot(fx, fz)
  const tangent =
    distance > options.orbitRadius ? Math.acos(options.orbitRadius / distance) : 0
  const angle = fromAngle + side * Math.min(arcFor(side), tangent + options.lookahead)

  out.set(
    circle.x + Math.cos(angle) * options.orbitRadius,
    goal.y,
    circle.z + Math.sin(angle) * options.orbitRadius,
  )
  return side
}

// 원 안으로 들어온 위치를 원 둘레로 밀어내고, 원 안쪽으로 향하는 속도 성분을 제거한다.
// 밀어냈으면 true.
export function pushOutOfCircleXZ(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  circle: CircleXZ,
  fallbackDirection: THREE.Vector3,
): boolean {
  let nx = position.x - circle.x
  let nz = position.z - circle.z
  const distance = Math.hypot(nx, nz)
  if (distance >= circle.radius) return false

  if (distance > 1e-6) {
    nx /= distance
    nz /= distance
  } else {
    const length = Math.hypot(fallbackDirection.x, fallbackDirection.z) || 1
    nx = fallbackDirection.x / length
    nz = fallbackDirection.z / length
  }

  position.x = circle.x + nx * circle.radius
  position.z = circle.z + nz * circle.radius

  const inward = velocity.x * nx + velocity.z * nz
  if (inward < 0) {
    velocity.x -= inward * nx
    velocity.z -= inward * nz
  }
  return true
}
