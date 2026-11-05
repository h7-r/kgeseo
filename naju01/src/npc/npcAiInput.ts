// AI 입력 스냅숏 npc_ai_input/0.1 — 향후 판단 모델이 받을 플레이어 행동 · 진행 · NPC 상태. 순수 함수.
// 지금 실제로 읽을 수 있는 값만 넣는다. 없는 것(퍼즐 · 백엔드 · 이동 누적 거리)은 null 로 둔다 — 지어내지 않는다.
// 돌려주는 객체는 깊이 얼린 새 객체다(추적기 · 게임 객체와 참조를 나누지 않는다). JSON 으로 그대로 직렬화된다(NaN 없음 — 모르면 null).
import type { NpcBehavior } from "./behaviorState";
import type { ActivitySnapshot } from "./playerActivityTracker";

export const NPC_AI_INPUT_SCHEMA = "npc_ai_input/0.1";

export interface NpcAiInputSource {
  /** 대화 쪽에서 만들면 "manual". 자동 힌트 판단은 아직 없다 → 그 밖에는 null */
  intent: "manual" | null;
  /** 열린 대화 세션 (없으면 null) */
  dialog: { sessionId: number; turn: number } | null;
  activity: ActivitySnapshot;
  npc: {
    behavior: NpcBehavior;
    /** 플레이어–NPC 수평 거리 (m). 아직 모르면 null */
    distance: number | null;
    following: boolean | null;
    waiting: boolean | null;
  };
}

export interface NpcAiInput {
  readonly schema: typeof NPC_AI_INPUT_SCHEMA;
  readonly intent: "manual" | null;
  readonly session: {
    readonly dialog_session_id: number | null;
    readonly turn: number | null;
    /** 나주 ↔ FastAPI PlaySession 연동 전 — 늘 null */
    readonly play_session_id: null;
    /** 추적기 reset 횟수 (이 페이지 안의 세션 구분용) */
    readonly tracker_resets: number;
  };
  readonly clock: { readonly active_seconds: number };
  readonly player: {
    readonly zone: string | null;
    readonly moving: boolean;
    readonly running: boolean;
    readonly idle_seconds: number;
    /** 이동 누적 거리 — 게임의 MovementReport 에 있지만 NPC 훅에 연결되지 않아 null */
    readonly distance_travelled_m: null;
  };
  readonly progress: {
    readonly cleared_scenes: readonly number[];
    /** 씬 카운터가 건너뛴 번호 — 끝났는지 모른다 */
    readonly skipped_scene_numbers: readonly number[];
    /** director 의 임시 근접 「발견」 열쇠 — 백엔드 acquired_clue_ids(획득)와 다르다 */
    readonly discovered_clues: readonly string[];
    readonly cleared_blockers: readonly string[];
    readonly progress_count: number;
    readonly last_progress: { readonly type: string; readonly target: string; readonly at_s: number } | null;
    readonly since_last_progress_s: number;
    readonly zone_visits: Readonly<Record<string, number>>;
    readonly repeated_zones: readonly string[];
    readonly revisits: number;
  };
  readonly npc: {
    readonly behavior: NpcBehavior;
    readonly distance_m: number | null;
    readonly following: boolean | null;
    readonly waiting: boolean | null;
  };
  readonly recent_events: readonly {
    readonly type: string;
    readonly target: string;
    readonly at_s: number;
    readonly progress: boolean;
  }[];
  /** 나주에 퍼즐 장치가 없다 — null */
  readonly puzzle: null;
  /** 백엔드 상태(state_json · attempt_counts · hint_levels) 미연동 — null */
  readonly backend: null;
}

const finiteOrNull = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export function buildNpcAiInput(source: NpcAiInputSource): NpcAiInput {
  const a = source.activity;
  return deepFreeze({
    schema: NPC_AI_INPUT_SCHEMA,
    intent: source.intent,
    session: {
      dialog_session_id: source.dialog?.sessionId ?? null,
      turn: source.dialog?.turn ?? null,
      play_session_id: null,
      tracker_resets: a.resets,
    },
    clock: { active_seconds: a.activeSeconds },
    player: {
      zone: a.zone,
      moving: a.moving,
      running: a.running,
      idle_seconds: a.idleSeconds,
      distance_travelled_m: null,
    },
    progress: {
      cleared_scenes: [...a.clearedScenes],
      skipped_scene_numbers: [...a.skippedSceneNumbers],
      discovered_clues: [...a.discoveredClues],
      cleared_blockers: [...a.clearedBlockers],
      progress_count: a.progressCount,
      last_progress: a.lastProgress
        ? { type: a.lastProgress.type, target: a.lastProgress.target, at_s: a.lastProgress.at }
        : null,
      since_last_progress_s: a.sinceLastProgressSeconds,
      zone_visits: { ...a.zoneVisits },
      repeated_zones: [...a.repeatedZones],
      revisits: a.revisits,
    },
    npc: {
      behavior: source.npc.behavior,
      distance_m: finiteOrNull(source.npc.distance),
      following: source.npc.following,
      waiting: source.npc.waiting,
    },
    recent_events: a.recentEvents.map((e) => ({ type: e.type, target: e.target, at_s: e.at, progress: e.progress })),
    puzzle: null,
    backend: null,
  } as const);
}
