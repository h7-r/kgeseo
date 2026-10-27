import * as THREE from "three";
import { isPointClear, isSegmentClear } from "./collision";
import type { CollisionWorld } from "./collision";
import { HOVER_CONFIG } from "./hover";
import { npcProfile } from "./npcProfiler";
import { createPathState, planPath, resetPath } from "./pathfinding";
import { groundHeight, isTerrainSegmentWalkable } from "./terrain";
import type { NpcTerrain } from "./terrain";

// 플레이어 기준 동행 위치 후보와 선택 로직.
// 기본은 오른쪽 측후방이고, 장애물 때문에 쓸 수 없을 때만 다른 후보를 고른다.

// side: 진행 방향 기준 오른쪽(+)/왼쪽(-) 거리, back: 뒤쪽 거리 (m)
export interface CompanionSlot {
  id: string;
  side: number;
  back: number;
}

export const DEFAULT_SLOT: CompanionSlot = { id: "rightBack", side: 1.1, back: 0.8 };

// 선호 순서: 오른쪽 측후방 → 조금 가까운 오른쪽 측후방 → 뒤 → 왼쪽 측후방 → … → 옆
export const COMPANION_SLOTS: readonly CompanionSlot[] = [
  DEFAULT_SLOT,
  { id: "rightBackNear", side: 0.8, back: 0.55 },
  { id: "back", side: 0, back: 1.2 },
  { id: "leftBack", side: -1.1, back: 0.8 },
  { id: "leftBackNear", side: -0.8, back: 0.55 },
  { id: "right", side: 1.2, back: 0 },
  { id: "left", side: -1.2, back: 0 },
];

export const SLOT_CONFIG = {
  obstacleMargin: 0.1, // 후보 위치가 NPC 충돌 반경 바깥으로 더 떨어져야 하는 간격 (m)
  playerMargin: 0.05, // 플레이어 최소 이격 거리보다 더 떨어져야 하는 간격 (m)
  sightRadius: 0.05, // 플레이어→후보 직선이 장애물을 가로지르지 않는지 볼 때 쓰는 얇은 반경 (m)
  minHoldTime: 0.8, // 한 번 고른 위치를 최소 유지하는 시간 (s)
  returnDelay: 0.5, // 더 선호하는 위치가 이 시간 동안 계속 가능해야 되돌아간다 (s)
  resumeDelay: 0.25, // 대기 중에는 후보가 이 시간 동안 계속 가능해야 이동을 재개한다 (s)
  stuckTime: 1.0, // 막힌 채 진전이 없으면 이 시간 뒤 그 위치를 포기한다 (s)
  stuckProgress: 0.1, // 이만큼 가까워져야 진전으로 본다 (m)
  blockedTime: 2.5, // 포기한 위치를 다시 시도하지 않는 시간 (s)
  blockedClearMove: 0.5, // 플레이어가 이만큼 움직이면 포기 기록을 지운다 (m)
  maxHeightFromPlayer: 1.0, // 지형이 있을 때 후보 지면과 플레이어 발 높이 차 허용치 (m)
  // 그 프레임 그래프 예산이 없어 도달 가능 여부를 못 쟀을 때 지난 결과를 쓰는 기한 (s) · 그동안 후보가 움직여도 되는 거리 (m).
  // 지난 결과도 없으면: 지금 쓰는 위치는 계속 쓰고(대기로 떨어지지 않게), 다른 후보로는 이번 프레임에 옮기지 않는다.
  probeCacheTtl: 0.3,
  probeCacheMove: 0.5,
} as const;

export interface SlotState {
  current: CompanionSlot | null; // null = 쓸 수 있는 위치가 없어 대기 중
  heldFor: number; // 현재 위치를 유지한 시간 (s)
  preferredValidFor: number; // 더 선호하는 위치가 연속으로 가능했던 시간 (s)
  time: number; // 누적 시간 (s)
  blockedUntil: Map<string, number>; // 포기한 위치 id → 재시도 가능 시각
  blockedOrigin: THREE.Vector3; // 포기할 당시 플레이어 위치
  progressBest: number; // 진전 판정용: 지금까지 가장 짧았던 남은 경로 길이
  progressTimer: number; // 진전 없이 막혀 있던 시간 (s)
  // 후보 위치 id → 마지막으로 그래프를 풀어 본 도달 가능 여부. 그 프레임 예산이 없을 때만 꺼내 쓴다(probeCacheTtl).
  probeCache: Map<string, ProbeMemo>;
}

interface ProbeMemo {
  reachable: boolean;
  time: number; // 잰 시각 (state.time 기준, s)
  revision: number | null; // 잰 충돌 세계 판
  x: number; // 잰 후보 위치 (m)
  z: number;
}

export function createSlotState(): SlotState {
  return {
    current: DEFAULT_SLOT,
    heldFor: 0,
    preferredValidFor: 0,
    time: 0,
    blockedUntil: new Map(),
    blockedOrigin: new THREE.Vector3(),
    progressBest: Infinity,
    progressTimer: 0,
    probeCache: new Map(),
  };
}

// 대상 위치와 진행 방향(yaw)으로 후보 위치를 계산한다. y는 NPC 추적 높이.
export function computeSlotPosition(
  slot: CompanionSlot,
  position: THREE.Vector3,
  yaw: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // forward = (sin, 0, cos), right = forward × up = (-cos, 0, sin)
  return out.set(
    position.x - cos * slot.side - sin * slot.back,
    position.y + HOVER_CONFIG.baseHeight,
    position.z + sin * slot.side - cos * slot.back,
  );
}

export interface SlotContext {
  world: CollisionWorld;
  player: THREE.Vector3; // 플레이어 발 위치
  // 위치 계산용 진행 방향 (회전이 부드럽게 따라가도록 지연된 값)
  yaw: number;
  // 후보 판정용 진행 방향 (지연 없는 최종 진행 방향). 회전이 끝나기 전 중간 각도에서
  // 후보가 벽을 쓸고 지나가며 좌우로 바뀌는 것을 막는다.
  settledYaw: number;
  npc: THREE.Vector3; // NPC 추적 위치
  minSeparation: number;
  delta: number;
  // 지형. 있으면 후보 높이를 지면에서 재고, 걸을 수 없는 땅·플레이어와 이어지지 않는 자리를 뺀다
  terrain?: NpcTerrain | null;
}

const candidate = new THREE.Vector3();
const playerAtNpcHeight = new THREE.Vector3();
const probe = createPathState();

// 위치 자체가 안전한지: 장애물 간격, 플레이어 거리, 플레이어와 같은 쪽(벽 너머가 아님)
// 지형이 있으면 후보 높이를 그 자리 지면 + 부유 기준 높이로 맞춘다 (없으면 플레이어 발 기준 그대로)
function placeOnGround(position: THREE.Vector3, ctx: SlotContext): void {
  if (!ctx.terrain) return;
  position.y = groundHeight(ctx.terrain, position.x, position.z) + HOVER_CONFIG.baseHeight;
}

function isPositionSafe(position: THREE.Vector3, ctx: SlotContext): boolean {
  const { world, player, minSeparation, terrain } = ctx;
  if (terrain) {
    // 강·절벽 같은 못 걷는 땅, 플레이어와 높이가 크게 다른 자리(턱 위·아래),
    // 플레이어에게서 걸어서 이어지지 않는 자리(강 건너 등)는 동행 위치로 쓰지 않는다
    if (!terrain.sample(position.x, position.z).walkable) return false;
    const ground = position.y - HOVER_CONFIG.baseHeight;
    if (Math.abs(ground - player.y) > SLOT_CONFIG.maxHeightFromPlayer) return false;
    if (!isTerrainSegmentWalkable(terrain, player.x, player.z, position.x, position.z)) return false;
  }
  const y = position.y;
  if (!isPointClear(world, position.x, position.z, y, world.radius + SLOT_CONFIG.obstacleMargin)) {
    return false;
  }
  if (Math.hypot(position.x - player.x, position.z - player.z) < minSeparation + SLOT_CONFIG.playerMargin) {
    return false;
  }
  playerAtNpcHeight.set(player.x, y, player.z);
  return isSegmentClear(world, playerAtNpcHeight, position, y, SLOT_CONFIG.sightRadius);
}

// 후보를 쓸 수 있는지: 최종 진행 방향 기준 위치가 안전하고 NPC가 도달 가능해야 한다
// whenUnknown: 그래프 예산이 없고 지난 결과도 쓸 수 없을 때의 답 (지금 위치 = true, 다른 후보 = false)
function isSlotUsable(
  state: SlotState,
  slot: CompanionSlot,
  ctx: SlotContext,
  out: THREE.Vector3,
  whenUnknown: boolean,
): boolean {
  const { world, player, minSeparation } = ctx;
  computeSlotPosition(slot, player, ctx.settledYaw, out);
  placeOnGround(out, ctx);
  if (!isPositionSafe(out, ctx)) return false;

  const probeStart = npcProfile.enabled ? performance.now() : 0;
  resetPath(probe);
  planPath(
    world,
    ctx.npc,
    out,
    probe,
    [{ x: player.x, z: player.z, radius: minSeparation }],
    0,
    ctx.terrain ?? null,
    "probe",
  );
  if (npcProfile.enabled) {
    npcProfile.counters.slotProbes++;
    npcProfile.counters.probeMs += performance.now() - probeStart;
  }
  const revision = world.revision ?? null;
  if (probe.deferred) {
    const memo = state.probeCache.get(slot.id);
    const fresh =
      memo !== undefined &&
      memo.revision === revision &&
      state.time - memo.time <= SLOT_CONFIG.probeCacheTtl &&
      Math.hypot(memo.x - out.x, memo.z - out.z) <= SLOT_CONFIG.probeCacheMove;
    return fresh ? memo.reachable : whenUnknown;
  }
  const reachable = probe.status !== "blocked";
  const memo = state.probeCache.get(slot.id);
  if (memo) {
    memo.reachable = reachable;
    memo.time = state.time;
    memo.revision = revision;
    memo.x = out.x;
    memo.z = out.z;
  } else {
    state.probeCache.set(slot.id, { reachable, time: state.time, revision, x: out.x, z: out.z });
  }
  return reachable;
}

function isBlocked(state: SlotState, slot: CompanionSlot): boolean {
  const until = state.blockedUntil.get(slot.id);
  return until !== undefined && until > state.time;
}

// 이번 프레임의 동행 위치를 골라 out에 기록한다. 쓸 수 있는 위치가 없으면 null(대기).
// - 지금 위치가 계속 쓸 만하면 유지한다.
// - 더 선호하는 위치가 returnDelay 동안 계속 가능하고 minHoldTime이 지났을 때만 되돌아간다.
// - 지금 위치가 막히면 선호 순서대로 다음 후보를 고른다.
export function selectCompanionSlot(state: SlotState, ctx: SlotContext, out: THREE.Vector3): CompanionSlot | null {
  state.time += ctx.delta;
  state.heldFor += ctx.delta;

  // 플레이어가 충분히 움직였으면 상황이 바뀐 것이므로 포기 기록을 지운다
  if (
    state.blockedUntil.size > 0 &&
    Math.hypot(ctx.player.x - state.blockedOrigin.x, ctx.player.z - state.blockedOrigin.z) >
      SLOT_CONFIG.blockedClearMove
  ) {
    state.blockedUntil.clear();
  }

  const currentIndex = state.current ? COMPANION_SLOTS.indexOf(state.current) : -1;
  const currentUsable =
    state.current !== null &&
    !isBlocked(state, state.current) &&
    isSlotUsable(state, state.current, ctx, candidate, true);

  // 현재 위치보다 선호하는 후보 중 처음으로 쓸 수 있는 것
  const searchEnd = currentUsable ? currentIndex : COMPANION_SLOTS.length;
  let better: CompanionSlot | null = null;
  for (let i = 0; i < searchEnd; i++) {
    const slot = COMPANION_SLOTS[i];
    if (!isBlocked(state, slot) && isSlotUsable(state, slot, ctx, candidate, false)) {
      better = slot;
      break;
    }
  }

  let next = state.current;
  if (!currentUsable && state.current === null) {
    // 대기 중: 후보가 잠깐 가능했다 막히는 경우 대기↔이동이 반복되지 않도록 잠시 확인 후 재개
    state.preferredValidFor = better ? state.preferredValidFor + ctx.delta : 0;
    next = better && state.preferredValidFor >= SLOT_CONFIG.resumeDelay ? better : null;
  } else if (!currentUsable) {
    // 지금 위치를 쓸 수 없으면 전체 후보 중 선호 순서대로 첫 번째 (없으면 대기)
    next = better;
    state.preferredValidFor = 0;
  } else if (better) {
    state.preferredValidFor += ctx.delta;
    if (state.preferredValidFor >= SLOT_CONFIG.returnDelay && state.heldFor >= SLOT_CONFIG.minHoldTime) {
      next = better;
    }
  } else {
    state.preferredValidFor = 0;
  }

  if (next !== state.current) {
    state.current = next;
    state.heldFor = 0;
    state.preferredValidFor = 0;
    state.progressBest = Infinity;
    state.progressTimer = 0;
  }

  if (state.current) {
    // 회전 중에는 지연된 방향으로 부드럽게 옮기되, 그 위치가 안전하지 않으면 최종 방향 위치를 쓴다
    computeSlotPosition(state.current, ctx.player, ctx.yaw, out);
    placeOnGround(out, ctx);
    if (!isPositionSafe(out, ctx)) {
      computeSlotPosition(state.current, ctx.player, ctx.settledYaw, out);
      placeOnGround(out, ctx);
    }
  }
  return state.current;
}

// 이동 후 호출: 막힌 채(장애물 접촉·플레이어에게 밀림) 진전이 없으면 현재 위치를 포기한다.
// 포기하면 true. 다음 프레임에 다른 후보를 고르거나, 없으면 대기한다.
export function trackSlotProgress(
  state: SlotState,
  remaining: number,
  pressing: boolean,
  player: THREE.Vector3,
  delta: number,
): boolean {
  if (!state.current) return false;
  if (remaining < state.progressBest - SLOT_CONFIG.stuckProgress) {
    state.progressBest = remaining;
    state.progressTimer = 0;
    return false;
  }
  state.progressTimer = pressing ? state.progressTimer + delta : 0;
  if (state.progressTimer < SLOT_CONFIG.stuckTime) return false;

  state.blockedUntil.set(state.current.id, state.time + SLOT_CONFIG.blockedTime);
  state.blockedOrigin.copy(player);
  state.current = null;
  state.heldFor = 0;
  state.progressBest = Infinity;
  state.progressTimer = 0;
  return true;
}

// 대화 재개 등으로 상황을 새로 시작할 때
export function resetSlotState(state: SlotState): void {
  state.blockedUntil.clear();
  state.progressBest = Infinity;
  state.progressTimer = 0;
  state.probeCache.clear();
}
