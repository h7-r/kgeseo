import * as THREE from 'three'
import { planDetourXZ, pushOutOfCircleXZ } from './avoidance'
import type { CircleXZ, DetourSide } from './avoidance'
import {
  createMoveResult,
  moveAndSlide,
  NPC_COLLISION_RADIUS,
  resolvePenetration,
} from './collision'
import type { CollisionWorld } from './collision'
import { createPathState, planPath, resetPath } from './pathfinding'
import type { PathState } from './pathfinding'
import {
  createSlotState,
  DEFAULT_SLOT,
  resetSlotState,
  selectCompanionSlot,
  trackSlotProgress,
} from './companionSlots'
import type { SlotState } from './companionSlots'
import { HOVER_CONFIG } from './hover'

// NPC가 따라갈 대상의 자세. 실제 게임 플레이어도 이 형태로만 넘겨주면 된다.
// position: 발 기준 월드 좌표, yaw: Y축 회전(라디안, 정면 = (sin yaw, 0, cos yaw))
// 측후방 목표는 이동 방향 기준이므로 yaw는 아직 움직이기 전의 초기 방향으로만 쓴다.
export interface FollowTargetPose {
  position: THREE.Vector3
  yaw: number
}

const SIDE_OFFSET = DEFAULT_SLOT.side // 대상 오른쪽 거리 (m)
const BACK_OFFSET = DEFAULT_SLOT.back // 대상 뒤쪽 거리 (m)
const MAX_SPEED = 2.8 // 최대 이동 속도 (m/s)
const PLAYER_RADIUS = 0.3 // 플레이어 더미 캡슐 반경 (m)
const NPC_RADIUS = NPC_COLLISION_RADIUS // NPC 구체 반경 (m)
const MIN_SEPARATION = PLAYER_RADIUS + NPC_RADIUS + 0.1

export const FOLLOW_CONFIG = {
  sideOffset: SIDE_OFFSET,
  backOffset: BACK_OFFSET,
  maxSpeed: MAX_SPEED,
  startDistance: 0.55, // 이 거리 이상 벌어지면 추적 시작 (m)
  stopDistance: 0.2, // 이 거리 이하로 붙으면 추적 중단 (m)
  slowRadius: 0.8, // 목표 근처에서 감속을 시작하는 반경 (m)
  responsiveness: 6, // 속도 변화 민첩도 (1/s, 클수록 빠르게 목표 속도에 도달)

  // 목표 위치 안정화: 목표가 도는 각속도를 NPC가 따라갈 수 있는 수준으로 제한한다.
  // 목표는 플레이어 중심에서 hypot(side, back) ≈ 1.36m 떨어져 있으므로
  // 이 각속도에서 목표의 접선 속도가 NPC 최대 속도와 같아진다.
  anchorTurnRate: MAX_SPEED / Math.hypot(SIDE_OFFSET, BACK_OFFSET), // rad/s
  anchorYawSmoothing: 5, // 목표 회전 각도 수렴 민첩도 (1/s)
  turnHoldTime: 0.25, // 회전 입력이 끊겨도 이 시간 동안은 같은 방향으로 회전 중으로 본다 (s)
  // 이 거리 이상 실제로 이동해야 진행 방향을 갱신한다. 제자리 회전·미세한 위치 오차는 무시된다. (m)
  headingMoveThreshold: 0.1,

  // 플레이어 주변 회피 (XZ 평면, 구체 중심 간 거리 기준)
  minSeparation: MIN_SEPARATION, // 이 거리 안으로는 절대 들어가지 않음 (m)
  detourCheckRadius: MIN_SEPARATION + 0.05, // 경로 교차 검사 반경 (m)
  detourOrbitRadius: MIN_SEPARATION + 0.25, // 경유점을 놓는 반경 (m)
  detourLookahead: 0.5, // 경유점 선행 각도 (rad)
  detourSwitchMargin: 0.6, // 우회 방향 전환에 필요한 각도 이득 (rad)
} as const

export interface FollowState {
  // 부유 오프셋을 뺀 추적 위치. 거리·충돌 계산은 항상 이 값으로 한다.
  position: THREE.Vector3
  velocity: THREE.Vector3
  following: boolean
  // 대상의 진행 방향. 카메라 방향이 아니라 실제 이동 경로로 정한다.
  headingYaw: number | null // null = 아직 초기화 전
  headingOrigin: THREE.Vector3 // 마지막으로 진행 방향을 갱신한 대상 위치
  // 목표 회전 안정화 상태. 각도는 모두 래핑하지 않은 누적값이다.
  anchorYaw: number | null // 목표 계산에 쓰는 회전값 (null = 아직 초기화 전)
  targetYaw: number // 대상의 누적 회전값
  lastPoseYaw: number // 직전 프레임의 대상 회전값 (래핑된 원본)
  turnDir: -1 | 0 | 1 // 대상이 현재 돌고 있는 방향
  turnHold: number // turnDir 유지 남은 시간 (s)
  anchor: THREE.Vector3 // 기본 동행 위치(오른쪽 측후방, 장애물 무시)
  // 실제로 가려는 위치: 장애물을 고려해 고른 동행 위치 (slots.current)
  goal: THREE.Vector3
  slots: SlotState // 동행 위치 후보 선택 상태
  // 쓸 수 있는 동행 위치가 없어 제자리에서 대기 중인지 (부유는 계속)
  waiting: boolean
  path: PathState // 장애물 우회 경로
  steerTarget: THREE.Vector3 // 이번 프레임에 실제로 향하는 지점 (목표 또는 경유점)
  detourSide: DetourSide
  // 이번 프레임에 최소 이격 보정이 일어났는지 (우회가 제대로 동작하면 플레이어가 다가올 때만 true)
  separationCorrected: boolean
  // 이번 프레임에 장애물에 닿아 이동이 제한됐는지
  obstacleContact: boolean
  // 플레이어와 장애물 사이에 끼어 최소 이격 거리를 지키지 못했는지 (장애물 관통 방지가 우선)
  pinned: boolean
}

export function createFollowState(start: THREE.Vector3): FollowState {
  return {
    position: start.clone(),
    velocity: new THREE.Vector3(),
    following: false,
    headingYaw: null,
    headingOrigin: new THREE.Vector3(),
    anchorYaw: null,
    targetYaw: 0,
    lastPoseYaw: 0,
    turnDir: 0,
    turnHold: 0,
    anchor: start.clone(),
    goal: start.clone(),
    slots: createSlotState(),
    waiting: false,
    path: createPathState(),
    steerTarget: start.clone(),
    detourSide: 0,
    separationCorrected: false,
    obstacleContact: false,
    pinned: false,
  }
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

// 대상 위치와 주어진 회전값으로 측후방 목표 위치를 계산해 out에 기록한다.
export function computeFollowAnchor(
  position: THREE.Vector3,
  yaw: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // forward = (sin, 0, cos), right = forward × up = (-cos, 0, sin)
  return out.set(
    position.x - cos * FOLLOW_CONFIG.sideOffset - sin * FOLLOW_CONFIG.backOffset,
    position.y + HOVER_CONFIG.baseHeight,
    position.z + sin * FOLLOW_CONFIG.sideOffset - cos * FOLLOW_CONFIG.backOffset,
  )
}

const TWO_PI = Math.PI * 2

// 대상이 일정 거리 이상 움직였을 때만 그 이동 방향으로 진행 방향을 갱신한다.
// 멈춘 동안에는 마지막 진행 방향을 그대로 유지한다.
function updateHeading(state: FollowState, pose: FollowTargetPose): number {
  if (state.headingYaw === null) {
    state.headingYaw = pose.yaw
    state.headingOrigin.copy(pose.position)
    return pose.yaw
  }
  const dx = pose.position.x - state.headingOrigin.x
  const dz = pose.position.z - state.headingOrigin.z
  if (dx * dx + dz * dz >= FOLLOW_CONFIG.headingMoveThreshold ** 2) {
    state.headingYaw = Math.atan2(dx, dz)
    state.headingOrigin.copy(pose.position)
  }
  return state.headingYaw
}

// 대상 회전을 그대로 쓰지 않고 지연·각속도 제한을 걸어, 빠른 제자리 회전에도
// 목표가 순간적으로 반대편으로 튀거나 좌우로 흔들리지 않게 한다.
function updateAnchorYaw(state: FollowState, poseYaw: number, delta: number): number {
  if (state.anchorYaw === null) {
    state.anchorYaw = poseYaw
    state.targetYaw = poseYaw
    state.lastPoseYaw = poseYaw
    return poseYaw
  }

  // 대상 회전을 누적해, 180°를 넘는 지연이 생겨도 회전 방향이 뒤집히지 않게 한다
  const yawStep = wrapAngle(poseYaw - state.lastPoseYaw)
  state.lastPoseYaw = poseYaw
  state.targetYaw += yawStep

  // 마우스 입력이 없는 프레임이 끼어도 회전 중으로 유지
  if (Math.abs(yawStep) > 1e-4) {
    state.turnDir = yawStep > 0 ? 1 : -1
    state.turnHold = FOLLOW_CONFIG.turnHoldTime
  } else {
    state.turnHold = Math.max(0, state.turnHold - delta)
    if (state.turnHold === 0) state.turnDir = 0
  }

  let diff = state.targetYaw - state.anchorYaw
  // 한 바퀴 이상 밀린 부분은 버린다 (방향은 그대로)
  while (Math.abs(diff) > TWO_PI) {
    const turn = Math.sign(diff) * TWO_PI
    state.targetYaw -= turn
    diff -= turn
  }
  // 대상이 그 방향으로 계속 돌고 있지 않을 때만 더 짧은 반대 방향으로 정리한다
  if (Math.abs(diff) > Math.PI && state.turnDir !== Math.sign(diff)) {
    const turn = Math.sign(diff) * TWO_PI
    state.targetYaw -= turn
    diff -= turn
  }

  const eased = diff * (1 - Math.exp(-FOLLOW_CONFIG.anchorYawSmoothing * delta))
  const limit = FOLLOW_CONFIG.anchorTurnRate * delta
  state.anchorYaw += Math.max(-limit, Math.min(limit, eased))

  // 누적값이 끝없이 커지지 않도록 함께 되돌린다 (각도 의미는 동일)
  if (Math.abs(state.anchorYaw) > 8 * TWO_PI) {
    const turns = Math.round(state.anchorYaw / TWO_PI) * TWO_PI
    state.anchorYaw -= turns
    state.targetYaw -= turns
  }
  return state.anchorYaw
}

const toSteer = new THREE.Vector3()
const desired = new THREE.Vector3()
const fallback = new THREE.Vector3()
const motion = new THREE.Vector3()
const pushed = new THREE.Vector3()
const moveResult = createMoveResult()

// 속도에서 접촉면을 파고드는 성분을 제거한다 (면을 따라 미끄러지는 속도만 남김)
function removeInto(velocity: THREE.Vector3, normal: THREE.Vector3): void {
  const into = velocity.x * normal.x + velocity.z * normal.z
  if (into < 0) {
    velocity.x -= into * normal.x
    velocity.z -= into * normal.z
  }
}

// 장애물이 있으면 관통하지 않도록 미끄러지며, 없으면 그대로 이동한다. 닿았으면 true.
function applyMotion(
  state: FollowState,
  delta: THREE.Vector3,
  world: CollisionWorld | null,
): boolean {
  if (!world) {
    state.position.add(delta)
    return false
  }
  moveAndSlide(world, state.position, delta, moveResult)
  if (moveResult.blocked) removeInto(state.velocity, moveResult.normal)
  return moveResult.blocked
}

// 장애물을 고려해 동행 위치를 고른다. 기본 오른쪽 측후방이 장애물에 가깝거나 플레이어와
// 벽을 사이에 두거나 도달할 수 없으면 다른 후보를, 모두 안 되면 대기(waiting)를 택한다.
function updateGoal(
  state: FollowState,
  pose: FollowTargetPose,
  world: CollisionWorld | null,
  yaw: number,
  delta: number,
) {
  state.goal.copy(state.anchor)
  state.waiting = false
  if (!world) return
  const slot = selectCompanionSlot(
    state.slots,
    {
      world,
      player: pose.position,
      yaw,
      settledYaw: state.headingYaw ?? yaw,
      npc: state.position,
      minSeparation: FOLLOW_CONFIG.minSeparation,
      delta,
    },
    state.goal,
  )
  state.waiting = slot === null
}

// 추적 위치를 delta(초)만큼 진행시킨다. 프레임레이트와 무관하게 동작한다.
// 순서: 목표 계산 → 장애물 우회 경로 → 플레이어 회피 경유점 → 이동(장애물 충돌)
//       → 최소 이격 보정(장애물 충돌)
// world가 없으면 장애물을 무시한다.
export function stepFollow(
  state: FollowState,
  pose: FollowTargetPose,
  delta: number,
  world: CollisionWorld | null = null,
): void {
  // 외부 요인으로 장애물 안에 들어가 있으면 먼저 빼낸다
  if (world) resolvePenetration(world, state.position)
  let contact = false

  const yaw = updateAnchorYaw(state, updateHeading(state, pose), delta)
  computeFollowAnchor(pose.position, yaw, state.anchor)
  updateGoal(state, pose, world, yaw, delta)

  const distance = state.position.distanceTo(state.goal)

  // 시작/중단 거리를 달리해 경계에서 떨림 없이 상태가 바뀌도록 한다.
  // 대기 중에는 이동하지 않는다 (벽을 밀지 않음).
  if (state.waiting) {
    state.following = false
  } else if (state.following && distance <= FOLLOW_CONFIG.stopDistance) {
    state.following = false
  } else if (!state.following && distance >= FOLLOW_CONFIG.startDistance) {
    state.following = true
  }

  const player: CircleXZ = {
    x: pose.position.x,
    z: pose.position.z,
    radius: FOLLOW_CONFIG.detourCheckRadius,
  }

  // 장애물 우회: 직선이 막혀 있으면 장애물 꼭짓점 경유점을 다음 지점으로 삼는다
  let waypoint = state.goal
  let remaining = distance
  if (state.following && world) {
    // 플레이어 이격 범위를 지나는 경유 경로는 고르지 않는다 (플레이어와 장애물 사이 좁은 틈 등)
    planPath(world, state.position, state.goal, state.path, [
      { x: pose.position.x, z: pose.position.z, radius: FOLLOW_CONFIG.minSeparation },
    ], delta)
    waypoint = state.path.nextWaypoint
    remaining = state.path.remaining
  } else {
    resetPath(state.path)
  }

  if (state.following && state.path.status === 'blocked') {
    // 갈 수 있는 경로가 없으면 벽을 뚫거나 순간이동하지 않고 제자리에서 기다린다
    state.detourSide = 0
    state.steerTarget.copy(state.position)
    desired.set(0, 0, 0)
  } else if (state.following) {
    // 다음 지점까지의 직선이 플레이어를 지나면 플레이어 둘레의 경유점으로 향한다
    state.detourSide = planDetourXZ(
      state.position,
      waypoint,
      player,
      state.detourSide,
      {
        orbitRadius: FOLLOW_CONFIG.detourOrbitRadius,
        lookahead: FOLLOW_CONFIG.detourLookahead,
        switchMargin: FOLLOW_CONFIG.detourSwitchMargin,
      },
      state.steerTarget,
    )

    toSteer.subVectors(state.steerTarget, state.position)
    const steerDistance = toSteer.length()
    // 감속은 최종 목표까지 남은 경로 길이로 판단 (경유점에서 멈칫하지 않도록)
    const speed =
      FOLLOW_CONFIG.maxSpeed * Math.min(1, remaining / FOLLOW_CONFIG.slowRadius)
    if (steerDistance > 1e-6) {
      desired.copy(toSteer).multiplyScalar(speed / steerDistance)
    } else {
      desired.set(0, 0, 0)
    }
  } else {
    state.detourSide = 0
    state.steerTarget.copy(state.goal)
    desired.set(0, 0, 0)
  }

  // 지수 보간: 프레임 간격이 달라도 같은 시간 동안 같은 만큼 수렴
  const blend = 1 - Math.exp(-FOLLOW_CONFIG.responsiveness * delta)
  state.velocity.lerp(desired, blend)
  if (state.velocity.lengthSq() > FOLLOW_CONFIG.maxSpeed ** 2) {
    state.velocity.setLength(FOLLOW_CONFIG.maxSpeed)
  }

  // 추적 중에는 향하는 지점을 지나치지 않도록 이동량을 남은 거리로 제한
  const velocityLength = state.velocity.length()
  let step = velocityLength * delta
  if (state.following) step = Math.min(step, state.position.distanceTo(state.steerTarget))
  if (step > 0) {
    motion.copy(state.velocity).multiplyScalar(step / velocityLength)
    contact = applyMotion(state, motion, world)
  }

  // 최종 안전장치: 플레이어가 NPC 쪽으로 걸어오는 경우 등에도 몸체를 겹치지 않는다.
  // 밀어내는 이동도 장애물 충돌을 거치므로 벽 쪽으로 밀리면 벽을 따라 옆으로 빠져나간다.
  fallback.set(-Math.cos(yaw), 0, Math.sin(yaw)) // 겹친 중심이면 진행 방향 기준 오른쪽으로 밀어냄
  pushed.copy(state.position)
  state.separationCorrected = pushOutOfCircleXZ(
    pushed,
    state.velocity,
    { x: pose.position.x, z: pose.position.z, radius: FOLLOW_CONFIG.minSeparation },
    fallback,
  )
  if (state.separationCorrected) {
    motion.subVectors(pushed, state.position)
    if (applyMotion(state, motion, world)) contact = true
  }

  state.obstacleContact = contact

  // 막힌 채(벽 접촉·플레이어에게 밀림·경로 없음) 목표에 가까워지지 못하면 그 위치를 포기한다.
  // 다음 프레임에 다른 후보를 고르거나, 없으면 대기한다.
  if (world && state.following) {
    const pressing =
      contact || state.separationCorrected || state.path.status === 'blocked'
    trackSlotProgress(state.slots, remaining, pressing, pose.position, delta)
  }

  // 장애물 관통 방지가 우선이라, 플레이어와 벽 사이에 끼면 이격 거리가 일시적으로 줄 수 있다
  state.pinned =
    Math.hypot(state.position.x - pose.position.x, state.position.z - pose.position.z) <
    FOLLOW_CONFIG.minSeparation - 1e-3
}

// 대화 등으로 추적을 멈췄다가 다시 시작할 때 호출한다.
// 멈춘 동안의 속도를 버리고, 진행 방향 판정을 대상의 현재 위치에서 새로 시작한다.
export function resumeFollow(state: FollowState, pose: FollowTargetPose): void {
  state.velocity.set(0, 0, 0)
  state.following = false
  state.detourSide = 0
  resetPath(state.path)
  resetSlotState(state.slots)
  if (state.headingYaw !== null) state.headingOrigin.copy(pose.position)
}
