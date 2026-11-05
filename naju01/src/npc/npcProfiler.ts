// NPC 추적 계측 — 개발 환경에서만 켠다(useNajuNpcFollow 가 ?npcprof 일 때, 또는 검사 스크립트가 직접).
// 꺼져 있으면 각 계측 지점은 `if (npcProfile.enabled)` 하나만 지나가고 아무것도 만들지 않는다.
// 카운터는 한 프레임 동안 쌓이고 najuNpcController 가 프레임마다 0 으로 되돌린다.

export interface NpcFrameCounters {
  /** planPath 호출 수 (추적 1 + 동행 후보 검사마다 1) */
  pathPlans: number;
  /** 그중 경유점 그래프를 실제로 푼 수 (직선 통과·재계산 쉼·원거리 대기가 아닌 것) */
  graphSolves: number;
  /** 동행 후보 위치 검사 수 */
  slotProbes: number;
  /** 그래프 예산이 없어 미룬 수 (추적 · 후보 검사) */
  deferredFollow: number;
  deferredProbes: number;
  /** 지형 표본(NpcTerrain.sample) 호출 수 */
  terrainSamples: number;
  /** 그래프 풀이에 든 시간 (ms) */
  graphMs: number;
  /** 동행 후보 검사에 든 시간 (ms, 그 안의 그래프 풀이 포함) */
  probeMs: number;
}

export const npcProfile: { enabled: boolean; counters: NpcFrameCounters } = {
  enabled: false,
  counters: {
    pathPlans: 0,
    graphSolves: 0,
    slotProbes: 0,
    deferredFollow: 0,
    deferredProbes: 0,
    terrainSamples: 0,
    graphMs: 0,
    probeMs: 0,
  },
};

export function resetNpcFrameCounters(): void {
  const c = npcProfile.counters;
  c.pathPlans = 0;
  c.graphSolves = 0;
  c.slotProbes = 0;
  c.deferredFollow = 0;
  c.deferredProbes = 0;
  c.terrainSamples = 0;
  c.graphMs = 0;
  c.probeMs = 0;
}

/** 느린 프레임 한 장 — 계측이 켜진 동안 컨트롤러가 채운다 */
export interface NpcSlowFrame extends NpcFrameCounters {
  frame: number;
  /** 컨트롤러가 처음 돈 뒤 지난 시간 (ms, performance.now 기준) */
  sinceStartMs: number;
  /** 한 걸음 전체 (ms) */
  totalMs: number;
  /** 충돌 세계 갱신(collisionNear) (ms) */
  collisionMs: number;
  /** 추적 한 걸음(advanceFollow) (ms, 그래프 풀이·후보 검사 포함) */
  followMs: number;
  active: boolean;
  following: boolean;
  waiting: boolean;
  pathStatus: string;
  slot: string | null;
  distance: number;
}

export interface NpcProfileReport {
  /** 계측이 켜진 뒤 센 프레임 */
  frames: number;
  over4ms: number;
  over16ms: number;
  /** 단계별 누적 (ms) */
  totals: { collisionMs: number; followMs: number; graphMs: number; probeMs: number };
  /** 누적 횟수 */
  counts: {
    pathPlans: number;
    graphSolves: number;
    slotProbes: number;
    deferredFollow: number;
    deferredProbes: number;
    terrainSamples: number;
  };
  /** 느린 순서 상위 N (가장 느린 것이 0) */
  slowest: NpcSlowFrame[];
}

export const NPC_PROFILE_SLOWEST = 10;

export function createProfileReport(): NpcProfileReport {
  return {
    frames: 0,
    over4ms: 0,
    over16ms: 0,
    totals: { collisionMs: 0, followMs: 0, graphMs: 0, probeMs: 0 },
    counts: { pathPlans: 0, graphSolves: 0, slotProbes: 0, deferredFollow: 0, deferredProbes: 0, terrainSamples: 0 },
    slowest: [],
  };
}
