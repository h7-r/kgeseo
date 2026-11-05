// 플레이어 행동 · 진행 추적기 — AI 입력(npcAiInput)의 재료. 순수 로직(React · Three.js · 게임 모듈 의존 없음).
// 훅이 매 프레임 frame() 으로 플레이어 상태를, poll 로 나온 게임 이벤트를 record() 로 넣는다.
//
// [시계] 「놀이 시간」만 센다: 씬이 움직이는 프레임(active)의 delta 를 MAX_FRAME_SECONDS 로 잘라 더한다.
//   부감 · 검수 고정 · 포인터 잠금 전(active=false)에는 멈춘다. 탭이 잠들었다 깨서 delta 가 튀어도 한 프레임에 0.1 초만 더한다.
//   그래서 유휴 · 정체 시간은 「실제로 플레이한 시간 중」 값이다. 벽시계(Date)는 쓰지 않는다.
// [진행] scene_cleared · 처음 보는 clue_discovered(clue_key) · 처음 보는 blocker_cleared(코드)만. zone_entered 는 탐색이라 진행이 아니다.
// [중복] event_id 가 같으면 무시하고, 다른 event_id 라도 같은 단서 열쇠 · 차단물 코드 · 씬 번호면 진행으로 다시 세지 않는다.
// [세션] reset() 이 모든 기록을 지운다. 지난 기록을 복원하지 않는다(저장소가 없다).
// [단서] clue_discovered 는 director 의 임시 근접 판정이다 — 백엔드 acquired_clue_ids(획득)와 같은 뜻이 아니다.
import type { GameEvent, GameEventType } from "./gameEvents";

export const ACTIVITY_CONFIG = {
  /** 한 프레임에 더하는 최대 시간 (s) — 컨트롤러의 MAX_STEP_SECONDS 와 같다 */
  maxFrameSeconds: 0.1,
  /** 최근 이벤트 몇 개를 들고 있을지 */
  recentEventLimit: 10,
  /** 중복 판정용 event_id 기억 수 */
  seenLimit: 2000,
};

export interface ActivityFrame {
  /** 이번 프레임 delta (s) */
  dt: number;
  /** 씬이 움직이는 중 (useNajuNpcFollow 의 active) */
  active: boolean;
  /** 플레이어가 움직이는 중 (AvatarLink.moving) */
  moving: boolean;
  running: boolean;
  /** 플레이어 발밑 구역. 통로 · 모름이면 null */
  zone: string | null;
}

export interface ActivityEventEntry {
  type: GameEventType;
  target: string;
  /** 받았을 때의 놀이 시간 (s) */
  at: number;
  progress: boolean;
}

export interface ActivityProgressEntry {
  type: "scene_cleared" | "clue_discovered" | "blocker_cleared";
  target: string;
  at: number;
}

/** 읽기 전용 사본 — 추적기 내부와 참조를 나누지 않는다 */
export interface ActivitySnapshot {
  /** 지금까지 센 놀이 시간 (s) */
  activeSeconds: number;
  /** 아직 한 프레임도 받지 않았으면 false */
  started: boolean;
  moving: boolean;
  running: boolean;
  /** 마지막으로 움직인 뒤 놀이 시간 (s). 아직 움직인 적 없으면 추적 시작부터 */
  idleSeconds: number;
  zone: string | null;
  /** 구역별 들어선 횟수 (프레임의 구역 변화 · 통로는 건너뜀) — 처음 서 있던 구역도 1 로 센다. 씬이 멈춘 동안은 갱신되지 않는다 */
  zoneVisits: Readonly<Record<string, number>>;
  /** 두 번 이상 들어선 구역 (이름순) */
  repeatedZones: readonly string[];
  /** 같은 구역에 다시 들어선 총 횟수 (각 구역 visits − 1 의 합) */
  revisits: number;
  progressCount: number;
  lastProgress: Readonly<ActivityProgressEntry> | null;
  /** 마지막 진행 뒤 놀이 시간 (s). 진행이 없으면 추적 시작부터 */
  sinceLastProgressSeconds: number;
  clearedScenes: readonly number[];
  /** 씬 카운터가 건너뛴 번호 — 끝났는지 모른다(게임 카운터는 최댓값만 올라감) */
  skippedSceneNumbers: readonly number[];
  discoveredClues: readonly string[];
  clearedBlockers: readonly string[];
  recentEvents: readonly Readonly<ActivityEventEntry>[];
  /** 받은 이벤트 중 중복으로 버린 수 */
  duplicates: number;
  /** reset 횟수 (세션 번호처럼 쓴다) */
  resets: number;
}

export interface PlayerActivityTracker {
  frame(frame: ActivityFrame): void;
  /** 게임 이벤트를 넣는다. 같은 event_id 는 한 번만 센다 */
  record(events: readonly GameEvent[]): void;
  /** 새 세션 — 기록을 모두 지운다 */
  reset(reason: string): void;
  snapshot(): ActivitySnapshot;
  /** 지금 놀이 시각 (s) — 스냅숏을 만들지 않는 싼 읽기 */
  now(): number;
  /** 지금까지 진행 수 — 싼 읽기 */
  progressCount(): number;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export function createPlayerActivityTracker(config = ACTIVITY_CONFIG): PlayerActivityTracker {
  let clock = 0;
  let started = false;
  let moving = false;
  let running = false;
  let lastMovedAt = 0;
  let zone: string | null = null;
  let zoneVisits = new Map<string, number>();
  let seen = new Set<string>();
  let duplicates = 0;
  let progressCount = 0;
  let lastProgress: ActivityProgressEntry | null = null;
  let lastProgressAt = 0;
  let scenes = new Set<number>();
  let sceneHigh = 0;
  let skipped = new Set<number>();
  let clues = new Set<string>();
  let blockers = new Set<string>();
  let recent: ActivityEventEntry[] = [];
  let resets = 0;

  const markProgress = (type: ActivityProgressEntry["type"], target: string) => {
    progressCount++;
    lastProgress = { type, target, at: clock };
    lastProgressAt = clock;
  };

  const visit = (code: string) => zoneVisits.set(code, (zoneVisits.get(code) ?? 0) + 1);

  return {
    frame(f) {
      if (f.active) {
        const dt = Math.min(Math.max(Number.isFinite(f.dt) ? f.dt : 0, 0), config.maxFrameSeconds);
        clock += dt;
      }
      if (!started) {
        started = true;
        lastMovedAt = clock;
        lastProgressAt = clock;
      }
      moving = f.moving;
      running = f.running;
      if (moving) lastMovedAt = clock;
      // 구역 방문은 프레임의 구역 변화로 센다(게임 이벤트 비교와 같은 규칙: 통로 null 은 건너뛰고 직전 구역 유지).
      // 처음 서 있던 구역도 한 번으로 센다. zone_entered 이벤트는 최근 이벤트로만 남긴다(두 번 세지 않게)
      if (f.zone !== null && f.zone !== zone) {
        zone = f.zone;
        visit(f.zone);
      }
    },
    record(events) {
      for (const event of events) {
        if (seen.has(event.event_id)) {
          duplicates++;
          continue;
        }
        seen.add(event.event_id);
        if (seen.size > config.seenLimit) seen.delete(seen.values().next().value as string);
        let progress = false;
        switch (event.event_type) {
          case "zone_entered":
            break; // 탐색 — 진행이 아니다. 방문 수는 frame 이 센다
          case "clue_discovered":
            if (!clues.has(event.clue_key)) {
              clues.add(event.clue_key);
              progress = true;
              markProgress("clue_discovered", event.clue_key);
            }
            break;
          case "blocker_cleared":
            if (!blockers.has(event.target_id)) {
              blockers.add(event.target_id);
              progress = true;
              markProgress("blocker_cleared", event.target_id);
            }
            break;
          case "scene_cleared":
            if (!scenes.has(event.scene)) {
              scenes.add(event.scene);
              skipped.delete(event.scene);
              for (let k = sceneHigh + 1; k < event.scene; k++) if (!scenes.has(k)) skipped.add(k);
              sceneHigh = Math.max(sceneHigh, event.scene);
              progress = true;
              markProgress("scene_cleared", event.target_id);
            }
            break;
        }
        recent = [...recent, { type: event.event_type, target: event.target_id, at: clock, progress }].slice(
          -config.recentEventLimit,
        );
      }
    },
    reset() {
      clock = 0;
      started = false;
      moving = false;
      running = false;
      lastMovedAt = 0;
      zone = null;
      zoneVisits = new Map();
      seen = new Set();
      duplicates = 0;
      progressCount = 0;
      lastProgress = null;
      lastProgressAt = 0;
      scenes = new Set();
      sceneHigh = 0;
      skipped = new Set();
      clues = new Set();
      blockers = new Set();
      recent = [];
      resets++;
    },
    now: () => clock,
    progressCount: () => progressCount,
    snapshot() {
      const visits: Record<string, number> = {};
      for (const [code, n] of [...zoneVisits].sort(([a], [b]) => a.localeCompare(b))) visits[code] = n;
      const repeatedZones = Object.keys(visits).filter((code) => visits[code] >= 2);
      return deepFreeze({
        activeSeconds: round(clock),
        started,
        moving,
        running,
        idleSeconds: round(clock - lastMovedAt),
        zone,
        zoneVisits: visits,
        repeatedZones,
        revisits: Object.values(visits).reduce((sum, n) => sum + Math.max(0, n - 1), 0),
        progressCount,
        lastProgress: lastProgress ? { ...(lastProgress as ActivityProgressEntry), at: round(lastProgress.at) } : null,
        sinceLastProgressSeconds: round(clock - lastProgressAt),
        clearedScenes: [...scenes].sort((a, b) => a - b),
        skippedSceneNumbers: [...skipped].sort((a, b) => a - b),
        discoveredClues: [...clues],
        clearedBlockers: [...blockers],
        recentEvents: recent.map((e) => ({ ...e, at: round(e.at) })),
        duplicates,
        resets,
      });
    },
  };
}
