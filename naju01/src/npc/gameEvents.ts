// 나주 동행 NPC 가 받는 게임 이벤트 계약 — NPC 쪽 내부용(팀 공식 이벤트·백엔드 API 계약과 별개). React·Three.js 의존 없음.
// 나주 게임에는 이벤트를 내보내는 장치가 없다. najuGameEventSource 가 게임 상태를 읽어 비교해 이 모양으로 만든다.
//
// [프로토타입(feat/SJ-npc-follow-prototype · src/npc/gameEvents.ts)과 다른 점]
//   clue_acquired    → clue_discovered  나주에는 「획득」이 없다. director 의 scanClues 가 씬 물체에 2.5 m 안으로
//                                        처음 다가간 것을 「단서발견」으로 친다(stage.seenClues · 임시 판정).
//   puzzle_completed → scene_cleared    퍼즐 장치가 없다. 씬 완료(endScene → scenePassed → focus.clearedScenes)를 본다.
//   zone_entered     → 이름 그대로       target_id 가 구역 코드(Z1~Z4)가 됐다.
//   종류마다 필드가 하나씩 늘었다: previous_zone · clue_key · scene. 공통 필드(event_id · event_type · target_id · source)는 그대로다.
//   blocker_cleared (7단계 추가)        프로토타입에 없다. 씬이 끝나 도면 차단물이 처음 치워졌다(terrain.clearedBlockers).

/** 나주 게임 상태에서 만든 이벤트의 source */
export const NAJU_GAME_SOURCE = "naju-game";

interface GameEventBase {
  /** 이벤트 고유 ID (중복 처리 기준). 게임 상태에서 정해진다 — 같은 상태 변화면 같은 ID */
  event_id: string;
  /** 발생 출처 (예: 'naju-game', 'dev', 'backend') */
  source: string;
  /** 규칙 표가 찾는 대상 */
  target_id: string;
}

/** 플레이어가 다른 구역에 들어섰다. 통로·연결로(구역 null)는 구역으로 치지 않는다 */
export interface ZoneEnteredEvent extends GameEventBase {
  event_type: "zone_entered";
  /** 들어선 구역 (Z1~Z4) */
  target_id: string;
  /** 직전에 있던 구역. 처음 들어선 구역이면 null */
  previous_zone: string | null;
}

/** 씬 물체에 처음 다가갔다 (director 의 임시 「단서발견」) */
export interface ClueDiscoveredEvent extends GameEventBase {
  event_type: "clue_discovered";
  /** 무리 이름 (예: '씬1.구렁이') */
  target_id: string;
  /** stage.seenClues 의 열쇠 그대로 (예: '씬1.구렁이#3') */
  clue_key: string;
}

/** 씬 n 이 끝났다 (focus.clearedScenes 가 n 으로 올라감) */
export interface SceneClearedEvent extends GameEventBase {
  event_type: "scene_cleared";
  /** 씬 번호 문자열 (예: '2') — 규칙 표 열쇠 */
  target_id: string;
  scene: number;
}

/** 도면 차단물이 처음 치워졌다 (무너짐 연출이 끝난 뒤 terrain.clearedBlockers 에 들어옴) */
export interface BlockerClearedEvent extends GameEventBase {
  event_type: "blocker_cleared";
  /** 차단물 코드 (예: 'B2') */
  target_id: string;
}

export type GameEvent = ZoneEnteredEvent | ClueDiscoveredEvent | SceneClearedEvent | BlockerClearedEvent;

export type GameEventType = GameEvent["event_type"];

export const GAME_EVENT_TYPES: readonly GameEventType[] = [
  "zone_entered",
  "clue_discovered",
  "scene_cleared",
  "blocker_cleared",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// 밖(개발 콘솔·JSON 등)에서 들어온 값을 검사한다. 계약에 맞지 않으면 null.
export function parseGameEvent(value: unknown): GameEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { event_id, target_id, source, event_type } = record;
  if (!isNonEmptyString(event_id) || !isNonEmptyString(target_id) || !isNonEmptyString(source)) return null;
  switch (event_type) {
    case "zone_entered": {
      const previous = record.previous_zone ?? null;
      if (previous !== null && !isNonEmptyString(previous)) return null;
      return { event_id, event_type, target_id, source, previous_zone: previous };
    }
    case "clue_discovered":
      if (!isNonEmptyString(record.clue_key)) return null;
      return { event_id, event_type, target_id, source, clue_key: record.clue_key };
    case "scene_cleared": {
      const scene = record.scene;
      if (typeof scene !== "number" || !Number.isInteger(scene) || scene < 1 || String(scene) !== target_id)
        return null;
      return { event_id, event_type, target_id, source, scene };
    }
    case "blocker_cleared":
      return { event_id, event_type, target_id, source };
    default:
      return null;
  }
}
