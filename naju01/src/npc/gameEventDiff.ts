// 게임 상태 스냅숏 두 장을 비교해 새로 생긴 NPC 게임 이벤트만 만든다 — 순수 로직(게임 모듈·React·Three.js 의존 없음).
// 게임 모듈을 읽는 쪽은 najuGameEventSource.ts 다. 여기는 주입된 스냅숏만 보므로 검사에서 상태를 마음대로 꾸며 넣을 수 있다.
//
// [규칙]
//   - 처음 본 스냅숏은 기준(baseline)으로만 삼는다 — 이미 있던 상태로는 이벤트를 만들지 않는다(마운트·재마운트).
//   - 같은 상태를 다시 보면 아무것도 만들지 않는다. Set 은 크기가 아니라 내용으로 비교하고, 지난 내용은 복사본으로 들고 있다
//     (게임은 같은 Set 을 제자리에서 고친다 — 참조만 들고 있으면 바뀐 것을 못 본다).
//   - 구역: 통로·연결로(null)는 구역으로 치지 않고 직전 구역을 유지한다(focusFog 와 같은 규칙). Z1 → 통로 → Z1 은 이벤트 없음.
//   - 씬 완료: 게임 카운터는 「최댓값만 올라간다」(scenePassed). 0 → 3 처럼 여러 칸 뛰면 scenePassed(3) 이 불린 것만 확실하고
//     1·2 가 끝났는지는 모른다 → 3 만 만들고 건너뛴 칸은 기록(note)만 남긴다.
//   - 줄어듦(단서가 빠짐 · 씬 수가 내려감 · 치운 차단물이 되살아남): 세션 재시작인지 알 수 없다(공식 세션 식별자가 없다).
//     이벤트를 만들지 않고 기록만 남긴다. 한 번 낸 단서·지난 씬 최고치는 잊지 않는다 — 다시 나타나도 또 내지 않는다.
//     기록을 지우고 새로 시작하는 것은 rebaseline() 을 명시적으로 부를 때뿐이다.
//   - 치운 차단물: 처음 치워진 코드만 blocker_cleared 로 낸다(7단계 — 진행 추적용). 되살아났다 다시 치워져도 또 내지 않는다.
//     경로 탐색은 이 이벤트와 상관없이 충돌 세계 판 번호로 따로 반영한다.
import { NAJU_GAME_SOURCE, type GameEvent } from "./gameEvents";

export interface NajuGameSnapshot {
  /** 플레이어 발밑 구역 (Z1~Z4). 통로·연결로·바깥이면 null */
  zone: string | null;
  /** director 가 본 단서 열쇠 (stage.seenClues) — 읽기만 한다 */
  seenClues: ReadonlySet<string>;
  /** 끝낸 씬 수 (focus.clearedScenes, 최댓값만 올라감) */
  clearedScenes: number;
  /** 치운 차단물 코드 (terrain.clearedBlockers) */
  clearedBlockers: ReadonlySet<string>;
  /** 연출(구역 진입 시점 컷) 중 */
  cutActive: boolean;
}

export type GameEventNote =
  | { kind: "baseline"; zone: string | null; clues: number; scenes: number; blockers: number }
  | { kind: "rebaseline"; reason: string }
  | { kind: "scenes-skipped"; from: number; to: number; skipped: number[] }
  | { kind: "scenes-decreased"; from: number; to: number }
  | { kind: "scenes-repeated"; scene: number; high: number }
  | { kind: "clues-removed"; keys: string[] }
  | { kind: "clues-repeated"; keys: string[] }
  | { kind: "blockers-cleared"; codes: string[] }
  | { kind: "blockers-restored"; codes: string[] }
  | { kind: "cut"; active: boolean };

export interface GameEventNoteEntry {
  /** observe 몇 번째에 남겼는지 */
  observation: number;
  note: GameEventNote;
}

export interface GameEventDiffState {
  hasBaseline: boolean;
  epoch: number;
  observations: number;
  emitted: number;
  zone: string | null;
  zoneEntries: number;
  clues: number;
  emittedClues: number;
  emittedBlockers: number;
  scenes: number;
  sceneHigh: number;
  blockers: string[];
  cutActive: boolean;
}

export interface GameEventDiffer {
  /** 지난 관측과 비교해 새로 생긴 이벤트만 돌려준다. 기준이 없으면 기준만 잡고 빈 배열 */
  observe(snapshot: NajuGameSnapshot): GameEvent[];
  /** 기준과 발행 기록을 지운다 — 다음 observe 가 기준을 다시 잡는다(그때 이벤트 없음) */
  rebaseline(reason: string): void;
  /** 최근 기록 (최신이 마지막) */
  readonly notes: readonly GameEventNoteEntry[];
  state(): GameEventDiffState;
}

export interface GameEventDifferOptions {
  source?: string;
  noteLimit?: number;
}

/** stage.seenClues 열쇠 `무리이름#번호` → 무리 이름 */
export function clueGroupOf(key: string): string {
  const cut = key.lastIndexOf("#");
  return cut > 0 ? key.slice(0, cut) : key;
}

/** a 의 내용이 b 와 같은지 (크기 + 원소). 같으면 아무것도 만들지 않는다 */
function sameContent(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function createGameEventDiffer({
  source = NAJU_GAME_SOURCE,
  noteLimit = 20,
}: GameEventDifferOptions = {}): GameEventDiffer {
  let hasBaseline = false;
  // rebaseline 마다 하나씩 — event_id 앞머리. 다시 잡은 기준 뒤의 이벤트가 앞 기준의 ID 와 겹쳐 중복으로 버려지지 않게 한다
  let epoch = 0;
  let observations = 0;
  let emitted = 0;
  let zone: string | null = null;
  let zoneEntries = 0;
  let clues = new Set<string>(); // 지난 관측의 복사본
  const emittedClues = new Set<string>(); // 기준 + 이미 낸 단서 — 빠졌다 다시 나타나도 또 내지 않는다
  const emittedBlockers = new Set<string>(); // 기준 + 이미 낸 차단물 코드
  let scenes = 0;
  let sceneHigh = 0; // 기준 이후 본 최고치
  let blockers = new Set<string>();
  let cutActive = false;
  let notes: GameEventNoteEntry[] = [];

  const note = (n: GameEventNote) => {
    notes = [...notes, { observation: observations, note: n }].slice(-noteLimit);
  };

  const takeBaseline = (s: NajuGameSnapshot) => {
    hasBaseline = true;
    zone = s.zone;
    clues = new Set(s.seenClues);
    for (const key of clues) emittedClues.add(key);
    for (const code of s.clearedBlockers) emittedBlockers.add(code);
    scenes = s.clearedScenes;
    sceneHigh = Math.max(sceneHigh, s.clearedScenes);
    blockers = new Set(s.clearedBlockers);
    cutActive = s.cutActive;
    note({ kind: "baseline", zone, clues: clues.size, scenes, blockers: blockers.size });
  };

  return {
    observe(s) {
      observations++;
      if (!hasBaseline) {
        takeBaseline(s);
        return [];
      }
      const events: GameEvent[] = [];

      // ── 구역 ── null(통로)은 건너뛰고 직전 구역을 유지한다
      if (s.zone !== null && s.zone !== zone) {
        zoneEntries++;
        events.push({
          event_id: `${epoch}:zone_entered:${zoneEntries}:${zone ?? "-"}>${s.zone}`,
          event_type: "zone_entered",
          target_id: s.zone,
          previous_zone: zone,
          source,
        });
        zone = s.zone;
      }

      // ── 단서 ── 내용 비교. 바뀌었을 때만 복사본을 새로 만든다
      if (!sameContent(s.seenClues, clues)) {
        const repeated: string[] = [];
        for (const key of s.seenClues) {
          if (clues.has(key)) continue;
          if (emittedClues.has(key)) {
            repeated.push(key);
            continue;
          }
          emittedClues.add(key);
          events.push({
            event_id: `${epoch}:clue_discovered:${key}`,
            event_type: "clue_discovered",
            target_id: clueGroupOf(key),
            clue_key: key,
            source,
          });
        }
        const removed = [...clues].filter((key) => !s.seenClues.has(key));
        if (removed.length) note({ kind: "clues-removed", keys: removed });
        if (repeated.length) note({ kind: "clues-repeated", keys: repeated });
        clues = new Set(s.seenClues);
      }

      // ── 씬 완료 ── 최고치를 넘을 때만. 건너뛴 칸은 만들지 않는다
      if (s.clearedScenes !== scenes) {
        const n = s.clearedScenes;
        if (n > sceneHigh) {
          if (n - sceneHigh > 1) {
            const skipped: number[] = [];
            for (let k = sceneHigh + 1; k < n; k++) skipped.push(k);
            note({ kind: "scenes-skipped", from: sceneHigh, to: n, skipped });
          }
          events.push({
            event_id: `${epoch}:scene_cleared:${n}`,
            event_type: "scene_cleared",
            target_id: String(n),
            scene: n,
            source,
          });
          sceneHigh = n;
        } else if (n < scenes) {
          note({ kind: "scenes-decreased", from: scenes, to: n });
        } else {
          note({ kind: "scenes-repeated", scene: n, high: sceneHigh });
        }
        scenes = n;
      }

      // ── 치운 차단물 ── 처음 치워진 것만 이벤트, 나머지는 기록만
      if (!sameContent(s.clearedBlockers, blockers)) {
        const added = [...s.clearedBlockers].filter((c) => !blockers.has(c));
        const restored = [...blockers].filter((c) => !s.clearedBlockers.has(c));
        for (const code of added) {
          if (emittedBlockers.has(code)) continue;
          emittedBlockers.add(code);
          events.push({
            event_id: `${epoch}:blocker_cleared:${code}`,
            event_type: "blocker_cleared",
            target_id: code,
            source,
          });
        }
        if (added.length) note({ kind: "blockers-cleared", codes: added });
        if (restored.length) note({ kind: "blockers-restored", codes: restored });
        blockers = new Set(s.clearedBlockers);
      }

      if (s.cutActive !== cutActive) {
        cutActive = s.cutActive;
        note({ kind: "cut", active: cutActive });
      }

      emitted += events.length;
      return events;
    },
    rebaseline(reason) {
      hasBaseline = false;
      epoch++;
      zone = null;
      clues = new Set();
      emittedClues.clear();
      emittedBlockers.clear();
      scenes = 0;
      sceneHigh = 0;
      blockers = new Set();
      cutActive = false;
      note({ kind: "rebaseline", reason });
    },
    get notes() {
      return notes;
    },
    state: () => ({
      hasBaseline,
      epoch,
      observations,
      emitted,
      zone,
      zoneEntries,
      clues: clues.size,
      emittedClues: emittedClues.size,
      emittedBlockers: emittedBlockers.size,
      scenes,
      sceneHigh,
      blockers: [...blockers],
      cutActive,
    }),
  };
}
