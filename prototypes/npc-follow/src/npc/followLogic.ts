import * as THREE from 'three'
import { planDetourXZ, pushOutOfCircleXZ } from './avoidance.ts'
import type { CircleXZ, DetourSide } from './avoidance.ts'
import {
  createCollisionWorld,
  createMoveResult,
  isPointClear,
  isSegmentClear,
  moveAndSlide,
  NPC_COLLISION_RADIUS,
  resolvePenetration,
} from './collision.ts'
import type { CollisionWorld } from './collision.ts'
import { createPathState, planPath, resetPath } from './pathfinding.ts'
import type { PathState } from './pathfinding.ts'
import {
  createSlotState,
  DEFAULT_SLOT,
  resetSlotState,
  selectCompanionSlot,
  trackSlotProgress,
} from './companionSlots.ts'
import type { SlotState } from './companionSlots.ts'
import { HOVER_CONFIG } from './hover.ts'
import { groundHeight, guardTerrainMove, isTerrainSegmentWalkable } from './terrain.ts'
import type { NpcTerrain } from './terrain.ts'

// NPC가 따라갈 대상의 자세. 실제 게임 플레이어도 이 형태로만 넘겨주면 된다.
// position: 발 기준 월드 좌표, yaw: Y축 회전(라디안, 정면 = (sin yaw, 0, cos yaw))
// 측후방 목표는 이동 방향 기준이므로 yaw는 아직 움직이기 전의 초기 방향으로만 쓴다.
export interface FollowTargetPose {
  position: THREE.Vector3
  yaw: number
  // 플레이어 수평 빠르기 (m/s). 부르는 쪽이 프레임 단위로 재서 넘기면 그 값을 쓴다 —
  // 한 프레임을 여러 걸음으로 나눠 부르면 여기서는 프레임 경계를 몰라 잴 수 없다(Codex 리뷰). 없으면 위치 변화로 어림한다
  speed?: number
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
  // 플레이어가 보는 쪽(pose.yaw) 좌우 이 각도 안은 우회 경로로 지나지 않는다 (rad).
  // 돌아서거나 뒷걸음하면 오른쪽 뒤에 있던 NPC 가 새 자리로 가며 눈앞 0.9 m 를 가로질러 길을 막았다(나주 11/11)
  frontAvoidHalfAngle: Math.PI / 3,
  // 보는 쪽 앞 길목 — 앞으로 이 거리(m) 안 · 좌우 이 폭(m) 안. 들어와 있으면 경유점보다 먼저 옆으로 비킨다.
  // 플레이어가 NPC 쪽으로 돌아서 걸어오면 NPC 가 그 둘레를 도는 동안 눈앞을 막았다
  frontLaneAhead: 2.0,
  frontLaneHalfWidth: 0.8,
  frontLaneExitMargin: 0.2, // 길목 밖으로 이만큼 더 나간 자리로 비킨다 (m)
  // 비키기를 이만큼(s) 해도 길목을 못 벗어나면 그만두고 원래 길(경유점)로 간다 — 벽에 붙어 눈앞에 남지 않게
  frontLaneGiveUpTime: 1.2,
  // 플레이어가 걷는 중일 때만 눈앞 길목에 드는 동행 위치를 고르지 않는다 — 서서 둘러볼 때까지 비키면 NPC 를 보려 할 때마다 달아난다.
  // 걷기 판정은 이 빠르기(m/s)를 넘으면 켜고, 아래 값 밑으로 내려가면 끈다(경계에서 깜빡이지 않게)
  laneWalkOnSpeed: 0.35,
  laneWalkOffSpeed: 0.2,
  // 플레이어 위치가 이만큼(s) 그대로면 멈춘 것으로 본다 — 한 프레임을 여러 걸음으로 나눠 부르면 걸음 사이엔 위치가 안 바뀐다
  speedStillTime: 0.25,

  // 플레이어가 한 프레임에 이보다 멀리 옮겨지면 텔레포트(낙하 복귀·시점 이동 등)로 본다 (m).
  // 걷기·달리기로는 한 프레임(최대 0.05 s)에 0.2 m 도 못 간다. NPC 는 따라 순간이동하지 않는다.
  teleportDistance: 3.0,
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
  // 쓸 수 있는 동행 위치가 없어 제자리에서 대기 중인지 (Follow 내부 상태, 부유는 계속)
  waiting: boolean
  // 직전 프레임에 추적이 켜져 있었는지 (Idle·Interact에서 Follow로 돌아올 때 재시작 판단)
  active: boolean
  path: PathState // 장애물 우회 경로
  steerTarget: THREE.Vector3 // 이번 프레임에 실제로 향하는 지점 (목표 또는 경유점)
  detourSide: DetourSide
  // 이번 프레임에 최소 이격 보정이 일어났는지 (우회가 제대로 동작하면 플레이어가 다가올 때만 true)
  separationCorrected: boolean
  // 이번 프레임에 장애물에 닿아 이동이 제한됐는지
  obstacleContact: boolean
  // 플레이어와 장애물 사이에 끼어 최소 이격 거리를 지키지 못했는지 (장애물 관통 방지가 우선)
  pinned: boolean
  // 이번 프레임에 지형(강·절벽·턱·허용 구역 밖) 때문에 이동이 막혔는지
  terrainBlocked: boolean
  // 플레이어 텔레포트 감지
  lastPlayerPosition: THREE.Vector3 | null
  teleportedThisFrame: boolean
  teleportCount: number
  // 눈앞 길목에서 비키는 데 쓴 시간 (s). 길목을 벗어나면 0
  laneEscapeTime: number
  // 플레이어 걷는 빠르기(m/s, 부드럽게 한 값) — 텔레포트는 셈하지 않는다
  playerSpeed: number
  speedClock: number // 플레이어 위치가 마지막으로 바뀐 뒤 흐른 시간 (s)
  isPlayerWalking: boolean // 걷기 판정(laneWalkOnSpeed / laneWalkOffSpeed)
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
    active: true,
    path: createPathState(),
    steerTarget: start.clone(),
    detourSide: 0,
    separationCorrected: false,
    obstacleContact: false,
    pinned: false,
    terrainBlocked: false,
    lastPlayerPosition: null,
    teleportedThisFrame: false,
    teleportCount: 0,
    laneEscapeTime: 0,
    playerSpeed: 0,
    speedClock: 0,
    isPlayerWalking: false,
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
const beforeMove = new THREE.Vector3()
// 지형만 있고 장애물 목록이 없을 때 쓰는 빈 충돌 세계
const EMPTY_WORLD = createCollisionWorld([])

// 속도에서 접촉면을 파고드는 성분을 제거한다 (면을 따라 미끄러지는 속도만 남김)
function removeInto(velocity: THREE.Vector3, normal: THREE.Vector3): void {
  const into = velocity.x * normal.x + velocity.z * normal.z
  if (into < 0) {
    velocity.x -= into * normal.x
    velocity.z -= into * normal.z
  }
}

// 장애물이 있으면 관통하지 않도록 미끄러지며, 없으면 그대로 이동한다. 닿았으면 true.
// 지형이 있으면 그 결과를 다시 지형으로 걸러, 못 걷는 땅·높은 턱 앞에서 멈추거나 축을 따라 미끄러진다.
function applyMotion(
  state: FollowState,
  delta: THREE.Vector3,
  world: CollisionWorld | null,
  terrain: NpcTerrain | null,
): boolean {
  if (!world) {
    state.position.add(delta)
    return false
  }
  beforeMove.copy(state.position)
  moveAndSlide(world, state.position, delta, moveResult)
  if (moveResult.blocked) removeInto(state.velocity, moveResult.normal)
  let blocked = moveResult.blocked
  if (terrain) {
    const guarded = guardTerrainMove(terrain, beforeMove.x, beforeMove.z, state.position.x, state.position.z)
    state.position.x = guarded.x
    state.position.z = guarded.z
    if (guarded.blocked) {
      if (guarded.blockedX) state.velocity.x = 0
      if (guarded.blockedZ) state.velocity.z = 0
      state.terrainBlocked = true
      blocked = true
    }
    state.position.y = groundHeight(terrain, state.position.x, state.position.z) + HOVER_CONFIG.baseHeight
  }
  return blocked
}

// 플레이어가 순간이동했으면 진행 방향·목표 회전·경로를 새 자리 기준으로 다시 잡는다.
// NPC 자신은 옮기지 않는다 — 갈 수 있으면 걸어서 따라가고, 길이 없으면 그 자리에서 기다린다.
function detectTeleport(state: FollowState, pose: FollowTargetPose): void {
  state.teleportedThisFrame = false
  const last = state.lastPlayerPosition
  if (last && last.distanceTo(pose.position) > FOLLOW_CONFIG.teleportDistance) {
    state.teleportedThisFrame = true
    state.teleportCount += 1
    state.headingYaw = pose.yaw
    state.headingOrigin.copy(pose.position)
    state.anchorYaw = pose.yaw
    state.targetYaw = pose.yaw
    state.lastPoseYaw = pose.yaw
    state.turnDir = 0
    state.turnHold = 0
    state.detourSide = 0
    resetPath(state.path)
    resetSlotState(state.slots)
  }
  if (last) last.copy(pose.position)
  else state.lastPlayerPosition = pose.position.clone()
}

// 장애물을 고려해 동행 위치를 고른다. 기본 오른쪽 측후방이 장애물에 가깝거나 플레이어와
// 벽을 사이에 두거나 도달할 수 없으면 다른 후보를, 모두 안 되면 대기(waiting)를 택한다.
function updateGoal(
  state: FollowState,
  pose: FollowTargetPose,
  world: CollisionWorld | null,
  yaw: number,
  delta: number,
  terrain: NpcTerrain | null,
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
      terrain,
      viewFront: {
        yaw: pose.yaw,
        halfAngle: FOLLOW_CONFIG.frontAvoidHalfAngle,
        lane:
          state.isPlayerWalking
            ? { ahead: FOLLOW_CONFIG.frontLaneAhead, halfWidth: FOLLOW_CONFIG.frontLaneHalfWidth }
            : null,
      },
    },
    state.goal,
  )
  state.waiting = slot === null
}

// 점이 플레이어가 보는 쪽 앞 길목 안인가. ahead = 앞(+) 거리, lateral = 오른쪽(+) 거리 (m)
const lane = { ahead: 0, lateral: 0 }
function readLane(pose: FollowTargetPose, point: THREE.Vector3) {
  const forwardX = Math.sin(pose.yaw)
  const forwardZ = Math.cos(pose.yaw)
  const dx = point.x - pose.position.x
  const dz = point.z - pose.position.z
  lane.ahead = dx * forwardX + dz * forwardZ
  lane.lateral = -dx * forwardZ + dz * forwardX // 오른쪽 = (-cos yaw, sin yaw)
  return lane
}
const isInLane = ({ ahead, lateral }: typeof lane) =>
  ahead > 0 && ahead < FOLLOW_CONFIG.frontLaneAhead && Math.abs(lateral) < FOLLOW_CONFIG.frontLaneHalfWidth

// NPC 가 눈앞 길목 안이고 가려는 자리는 밖이면, 지금 앞 거리 그대로 길목 옆 바깥을 향하게 steerTarget 을 바꾼다. 바꿨으면 true.
// 그쪽이 장애물 · 못 걷는 땅으로 막혔으면 반대쪽, 둘 다 막혔거나 오래(frontLaneGiveUpTime) 못 벗어나면 그만둔다(원래 길로)
const exitPoint = new THREE.Vector3()
function steerOutOfFrontLane(
  state: FollowState,
  pose: FollowTargetPose,
  delta: number,
  world: CollisionWorld | null,
  terrain: NpcTerrain | null,
): boolean {
  const goalLane = readLane(pose, state.goal)
  const goalLateral = goalLane.lateral
  const isGoalInLane = isInLane(goalLane)
  const { ahead, lateral } = readLane(pose, state.position)
  if (!isInLane(lane)) {
    state.laneEscapeTime = 0
    return false
  }
  if (isGoalInLane || state.laneEscapeTime > FOLLOW_CONFIG.frontLaneGiveUpTime) return false
  // 이미 한쪽으로 치우쳐 있으면 그쪽으로, 가운데면 가려는 자리 쪽으로
  const preferred = Math.abs(lateral) > 0.2 ? Math.sign(lateral) : Math.sign(goalLateral) || 1
  const forwardX = Math.sin(pose.yaw)
  const forwardZ = Math.cos(pose.yaw)
  const y = state.position.y
  for (const side of [preferred, -preferred]) {
    const offset = side * (FOLLOW_CONFIG.frontLaneHalfWidth + FOLLOW_CONFIG.frontLaneExitMargin)
    exitPoint.set(
      pose.position.x + forwardX * ahead - forwardZ * offset,
      y,
      pose.position.z + forwardZ * ahead + forwardX * offset,
    )
    if (world && !isPointClear(world, exitPoint.x, exitPoint.z, y)) continue
    if (world && !isSegmentClear(world, state.position, exitPoint, y)) continue
    if (
      terrain &&
      !isTerrainSegmentWalkable(terrain, state.position.x, state.position.z, exitPoint.x, exitPoint.z)
    ) {
      continue
    }
    state.steerTarget.copy(exitPoint)
    state.laneEscapeTime += delta
    return true
  }
  return false
}

// 플레이어 걷는 빠르기 — 위치가 바뀐 순간에 「바뀐 거리 / 지난번 바뀐 뒤 흐른 시간」으로 잰다.
// 한 프레임을 여러 걸음으로 나눠 불러도(같은 위치로 여러 번) 값이 출렁이지 않는다(Codex 리뷰). 텔레포트는 셈하지 않는다
function updatePlayerSpeed(
  state: FollowState,
  pose: FollowTargetPose,
  moved: number,
  delta: number,
): void {
  state.speedClock += delta
  if (pose.speed !== undefined) {
    // 넘겨받은 빠르기를 쓰되, 위치가 speedStillTime 동안 그대로면 0 — 화면 고정 · 경계에 막힘에서는
    // 걷기 훅의 빠르기가 남아 있어도 실제로는 서 있다(Codex 리뷰)
    if (state.teleportedThisFrame || moved > 1e-6) state.speedClock = 0
    const speed = state.speedClock > FOLLOW_CONFIG.speedStillTime ? 0 : pose.speed
    state.playerSpeed += (speed - state.playerSpeed) * (1 - Math.exp(-8 * delta))
  } else if (state.teleportedThisFrame) {
    state.speedClock = 0
  } else if (moved > 1e-6) {
    const measured = moved / state.speedClock
    state.playerSpeed += (measured - state.playerSpeed) * (1 - Math.exp(-8 * state.speedClock))
    state.speedClock = 0
  } else if (state.speedClock > FOLLOW_CONFIG.speedStillTime) {
    state.playerSpeed *= Math.exp(-8 * delta)
  }
  if (state.playerSpeed > FOLLOW_CONFIG.laneWalkOnSpeed) state.isPlayerWalking = true
  else if (state.playerSpeed < FOLLOW_CONFIG.laneWalkOffSpeed) state.isPlayerWalking = false
}

// 추적 위치를 delta(초)만큼 진행시킨다. 프레임레이트와 무관하게 동작한다.
// 순서: 목표 계산 → 장애물 우회 경로 → 플레이어 회피 경유점 → 이동(장애물 충돌)
//       → 최소 이격 보정(장애물 충돌)
// world가 없으면 장애물을 무시한다. terrain(지면 높이·이동 가능 영역)이 없으면 평지로 본다.
export function stepFollow(
  state: FollowState,
  pose: FollowTargetPose,
  delta: number,
  world: CollisionWorld | null = null,
  terrain: NpcTerrain | null = null,
): void {
  if (terrain && !world) world = EMPTY_WORLD
  state.terrainBlocked = false
  const lastPlayer = state.lastPlayerPosition
  const moved = lastPlayer
    ? Math.hypot(pose.position.x - lastPlayer.x, pose.position.z - lastPlayer.z)
    : 0
  detectTeleport(state, pose)
  updatePlayerSpeed(state, pose, moved, delta)
  // 눈앞 길목을 벗어났으면 비키기 시간을 비운다 — 대기 · 멈춤 중에 벗어나도(Codex 리뷰)
  if (!isInLane(readLane(pose, state.position))) state.laneEscapeTime = 0
  if (terrain) {
    state.position.y = groundHeight(terrain, state.position.x, state.position.z) + HOVER_CONFIG.baseHeight
  }
  // 외부 요인으로 장애물 안에 들어가 있으면 먼저 빼낸다
  if (world) resolvePenetration(world, state.position)
  let contact = false

  const yaw = updateAnchorYaw(state, updateHeading(state, pose), delta)
  computeFollowAnchor(pose.position, yaw, state.anchor)
  if (terrain) {
    state.anchor.y = groundHeight(terrain, state.anchor.x, state.anchor.z) + HOVER_CONFIG.baseHeight
  }
  updateGoal(state, pose, world, yaw, delta, terrain)

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
    planPath(
      world,
      state.position,
      state.goal,
      state.path,
      [{ x: pose.position.x, z: pose.position.z, radius: FOLLOW_CONFIG.minSeparation }],
      delta,
      terrain,
    )
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
    // 다음 지점까지의 직선이 플레이어를 지나면 플레이어 둘레의 경유점으로 향한다 — 보는 쪽 앞은 피해 등 뒤로 돈다
    state.detourSide = planDetourXZ(
      state.position,
      waypoint,
      player,
      state.detourSide,
      {
        orbitRadius: FOLLOW_CONFIG.detourOrbitRadius,
        lookahead: FOLLOW_CONFIG.detourLookahead,
        switchMargin: FOLLOW_CONFIG.detourSwitchMargin,
        // 정면 = (sin yaw, cos yaw) → XZ 각도 atan2(z, x)
        avoid: {
          angle: Math.atan2(Math.cos(pose.yaw), Math.sin(pose.yaw)),
          halfWidth: FOLLOW_CONFIG.frontAvoidHalfAngle,
        },
      },
      state.steerTarget,
    )

    // 눈앞 길목에 들어와 있으면 경유점보다 먼저 옆으로 비킨다(가려는 자리 자체가 길목이면 — 뒷걸음 등 — 그대로 간다)
    const isEscaping = steerOutOfFrontLane(state, pose, delta, world, terrain)

    toSteer.subVectors(state.steerTarget, state.position)
    const steerDistance = toSteer.length()
    // 감속은 최종 목표까지 남은 경로 길이로 판단 (경유점에서 멈칫하지 않도록). 비킬 때는 최고 속도로
    const speed = isEscaping
      ? FOLLOW_CONFIG.maxSpeed
      : FOLLOW_CONFIG.maxSpeed * Math.min(1, remaining / FOLLOW_CONFIG.slowRadius)
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
    contact = applyMotion(state, motion, world, terrain)
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
    if (applyMotion(state, motion, world, terrain)) contact = true
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

// 행동 상태에 따라 한 프레임을 진행한다.
// active=false(Idle·Interact): 위치를 그대로 두고 속도만 버린다. 경로·동행 위치 데이터는 유지한다.
// active로 돌아온 첫 프레임: 현재 NPC 위치에서 추적을 새로 시작한다(resumeFollow).
export function advanceFollow(
  state: FollowState,
  pose: FollowTargetPose,
  delta: number,
  world: CollisionWorld | null,
  active: boolean,
  terrain: NpcTerrain | null = null,
): void {
  if (!active) {
    state.velocity.set(0, 0, 0)
    state.following = false
    state.active = false
    return
  }
  if (!state.active) resumeFollow(state, pose)
  state.active = true
  stepFollow(state, pose, delta, world, terrain)
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
  // 멈춘 동안 플레이어가 걸어서 멀어진 것을 텔레포트로 오인하지 않게 기준을 새로 잡는다
  state.lastPlayerPosition = null
  state.speedClock = 0
  state.laneEscapeTime = 0
}
