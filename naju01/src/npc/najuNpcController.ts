// NPC 한 마리의 프레임 진행 — R3F·React 를 모르는 순수 로직이다.
// useNajuNpcFollow(게임 루프)와 시험 하네스(Node)가 같은 이 함수를 돌린다.
// 플레이어는 world.readPlayer 로 읽기만 하고, 그릴 자리(나주 월드 유닛)는 out 에 담아 돌려준다.
import * as THREE from "three";

import { advanceFollow, createFollowState, type FollowState, type FollowTargetPose } from "./followLogic";
import { HOVER_CONFIG, hoverOffset } from "./hover";
import type { NajuNpcWorld } from "./najuNpcAdapter";
import {
  createProfileReport,
  NPC_PROFILE_SLOWEST,
  npcProfile,
  resetNpcFrameCounters,
  type NpcProfileReport,
  type NpcSlowFrame,
} from "./npcProfiler";
import { beginGraphFrame } from "./pathfinding";
import { groundHeight } from "./terrain";

/**
 * 한 프레임에 진행하는 최대 시간 (s). 몰입 연출(director.tick)과 같은 값이다.
 * 탭이 잠들었다 깨는 등 긴 프레임에서 NPC 가 한 번에 멀리 튀지 않게 한다. 10 fps 아래로 떨어지면
 * 그만큼 NPC 가 실제 시간보다 느리게 움직인다(플레이어 이동은 dt 를 자르지 않는다).
 * 텔레포트 판정(FOLLOW_CONFIG.teleportDistance)은 플레이어의 한 프레임 이동 거리로만 보므로 이 값과 무관하다.
 */
export const MAX_STEP_SECONDS = 0.1;

/** 개발 도구·시험용 상태. 매 프레임 같은 객체를 고쳐 쓴다. 값은 도면 미터 */
export interface NajuNpcReport {
  frame: number;
  active: boolean;
  /** 추적 위치(부유 오프셋 제외) */
  position: { x: number; y: number; z: number };
  groundY: number;
  /** 이번 프레임에 NPC 가 읽은 플레이어 자세(발 높이). 아직 못 읽었으면 null */
  player: { x: number; y: number; z: number; yaw: number } | null;
  /** 플레이어와의 수평 거리 */
  distance: number;
  following: boolean;
  waiting: boolean;
  pathStatus: string;
  terrainBlocked: boolean;
  obstacleContact: boolean;
  separationCorrected: boolean;
  pinned: boolean;
  teleportCount: number;
  /** 그려진 위치 (나주 월드 유닛, 부유 오프셋 포함) */
  world: { x: number; y: number; z: number };
  /** 추적 한 걸음(advanceFollow + 충돌 세계 갱신) 비용 (ms) */
  stepMs: { last: number; max: number; total: number; frames: number };
  /** 추적 중 직선이 막혀 경유점 그래프를 푼 프레임 수 */
  plannedFrames: number;
}

export interface NajuNpcController {
  readonly follow: FollowState;
  readonly report: NajuNpcReport;
  /** 지형·소품이 다시 만들어졌을 때 갈아끼운다. 추적 상태는 그대로 이어진다 */
  setWorld(world: NajuNpcWorld): void;
  /**
   * 한 프레임 진행. delta 는 MAX_STEP_SECONDS 로 자른다.
   * active=false(부감·검수 고정 등)면 그 자리에 멈춘다. 다시 true 가 되면 그 자리에서 추적을 새로 시작한다.
   * 돌려주는 값은 out — 그릴 자리(나주 월드 유닛, 부유 오프셋 포함).
   */
  step(delta: number, active: boolean, elapsedSeconds: number, out: THREE.Vector3): THREE.Vector3;
  /** 계측 결과 (npcProfile.enabled 인 동안 쌓임). 켠 적이 없으면 null */
  profile(): NpcProfileReport | null;
  /** 계측 결과를 비운다 — 다음 계측 프레임부터 새로 쌓는다 */
  resetProfile(): void;
}

function createReport(): NajuNpcReport {
  return {
    frame: 0,
    active: false,
    position: { x: 0, y: 0, z: 0 },
    groundY: 0,
    player: null,
    distance: 0,
    following: false,
    waiting: false,
    pathStatus: "direct",
    terrainBlocked: false,
    obstacleContact: false,
    separationCorrected: false,
    pinned: false,
    teleportCount: 0,
    world: { x: 0, y: 0, z: 0 },
    stepMs: { last: 0, max: 0, total: 0, frames: 0 },
    plannedFrames: 0,
  };
}

/** spot 은 시작 자리 (도면 미터 x·z). 높이는 그 자리 지면 + 부유 기준 높이로 정한다 */
export function createNajuNpcController(
  initialWorld: NajuNpcWorld,
  spot: { readonly x: number; readonly z: number },
): NajuNpcController {
  let world = initialWorld;
  const start = new THREE.Vector3(spot.x, 0, spot.z);
  start.y = groundHeight(world.terrain, spot.x, spot.z) + HOVER_CONFIG.baseHeight;
  const follow = createFollowState(start);
  const report = createReport();
  const pose: FollowTargetPose = { position: new THREE.Vector3(), yaw: 0 };
  const point = { x: 0, y: 0, z: 0 };
  // 계측(npcProfile.enabled)이 처음 켜진 프레임에 만든다. 꺼져 있으면 null 그대로다
  let profile: NpcProfileReport | null = null;
  let profileStartMs: number | null = null;

  return {
    follow,
    report,
    setWorld(next) {
      world = next;
    },
    step(rawDelta, active, elapsedSeconds, out) {
      const delta = Math.min(Math.max(rawDelta, 0), MAX_STEP_SECONDS);
      const player = world.readPlayer(pose);

      const profiling = npcProfile.enabled;
      if (profiling) resetNpcFrameCounters();
      // 이 NPC 의 이번 프레임 그래프 예산 — 추적 경로와 동행 후보 검사가 나눠 쓴다(PATH_CONFIG.graphSolvesPerFrame)
      beginGraphFrame();
      const startMs = performance.now();
      let followStartMs = startMs;
      if (player) {
        // 멈춘 동안(active=false)에는 코어가 충돌 세계를 쓰지 않는다 — 만들지 않는다
        const collision = active ? world.collisionNear(follow.position.x, follow.position.z) : null;
        if (profiling) followStartMs = performance.now();
        advanceFollow(follow, player, delta, collision, active, world.terrain);
      }
      const endMs = performance.now();
      const stepMs = endMs - startMs;

      // 코어는 걸음을 떼기 전 자리의 땅으로 높이를 정한다. 그리는 높이는 옮긴 뒤 자리의 땅에 맞춘다
      // (멈춘 동안·플레이어를 아직 못 읽은 동안에도 지형이 다시 만들어지면 땅을 따라간다). 다음 걸음은 어차피
      // 그 자리 땅으로 다시 높이를 정하므로 추적 판정은 바뀌지 않는다.
      const groundY = groundHeight(world.terrain, follow.position.x, follow.position.z);
      follow.position.y = groundY + HOVER_CONFIG.baseHeight;
      point.x = follow.position.x;
      point.y = follow.position.y + hoverOffset(elapsedSeconds);
      point.z = follow.position.z;
      world.toWorld(point, out);

      report.frame += 1;
      report.active = active;
      report.position.x = follow.position.x;
      report.position.y = follow.position.y;
      report.position.z = follow.position.z;
      report.groundY = groundY;
      if (player) {
        report.player ??= { x: 0, y: 0, z: 0, yaw: 0 };
        report.player.x = player.position.x;
        report.player.y = player.position.y;
        report.player.z = player.position.z;
        report.player.yaw = player.yaw;
        report.distance = Math.hypot(follow.position.x - player.position.x, follow.position.z - player.position.z);
      }
      report.following = follow.following;
      report.waiting = follow.waiting;
      report.pathStatus = follow.path.status;
      report.terrainBlocked = follow.terrainBlocked;
      report.obstacleContact = follow.obstacleContact;
      report.separationCorrected = follow.separationCorrected;
      report.pinned = follow.pinned;
      report.teleportCount = follow.teleportCount;
      report.world.x = out.x;
      report.world.y = out.y;
      report.world.z = out.z;
      report.stepMs.last = stepMs;
      report.stepMs.max = Math.max(report.stepMs.max, stepMs);
      report.stepMs.total += stepMs;
      report.stepMs.frames += 1;
      if (follow.following && follow.path.status !== "direct") report.plannedFrames += 1;
      if (profiling) recordProfile(stepMs, followStartMs - startMs, endMs - followStartMs, endMs, active);
      return out;
    },
    profile() {
      return profile;
    },
    resetProfile() {
      profile = null;
    },
  };

  /** 계측이 켜진 프레임만 부른다. 느린 프레임 상위 N 에 들 때만 기록 객체를 만든다 */
  function recordProfile(totalMs: number, collisionMs: number, followMs: number, nowMs: number, active: boolean) {
    const p = (profile ??= createProfileReport());
    profileStartMs ??= nowMs;
    const c = npcProfile.counters;
    p.frames++;
    if (totalMs > 4) p.over4ms++;
    if (totalMs > 16.7) p.over16ms++;
    p.totals.collisionMs += collisionMs;
    p.totals.followMs += followMs;
    p.totals.graphMs += c.graphMs;
    p.totals.probeMs += c.probeMs;
    p.counts.pathPlans += c.pathPlans;
    p.counts.graphSolves += c.graphSolves;
    p.counts.slotProbes += c.slotProbes;
    p.counts.deferredFollow += c.deferredFollow;
    p.counts.deferredProbes += c.deferredProbes;
    p.counts.terrainSamples += c.terrainSamples;
    const list = p.slowest;
    if (list.length >= NPC_PROFILE_SLOWEST && totalMs <= list[list.length - 1].totalMs) return;
    const frame: NpcSlowFrame = {
      ...c,
      frame: report.frame,
      sinceStartMs: nowMs - profileStartMs,
      totalMs,
      collisionMs,
      followMs,
      active,
      following: follow.following,
      waiting: follow.waiting,
      pathStatus: follow.path.status,
      slot: follow.slots.current?.id ?? null,
      distance: report.distance,
    };
    let at = list.length;
    while (at > 0 && list[at - 1].totalMs < totalMs) at--;
    list.splice(at, 0, frame);
    if (list.length > NPC_PROFILE_SLOWEST) list.length = NPC_PROFILE_SLOWEST;
  }
}
