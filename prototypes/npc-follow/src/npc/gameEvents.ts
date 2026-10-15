// 프로토타입 내부용 게임 이벤트 계약 (팀 공식 이벤트·백엔드 API 계약과 별개).
// React·Three.js 의존성 없음.

interface GameEventBase {
  event_id: string // 이벤트 고유 ID (중복 처리 방지 기준)
  source: string // 발생 출처 (예: 'debug-ui', 'game', 'backend')
}

// 이벤트 종류마다 별도 인터페이스로 두어, 이후 종류별 필수 데이터가 생기면 각자 추가한다.
export interface ClueAcquiredEvent extends GameEventBase {
  event_type: 'clue_acquired'
  target_id: string // 단서 ID
}

export interface ZoneEnteredEvent extends GameEventBase {
  event_type: 'zone_entered'
  target_id: string // 구역 ID
}

export interface PuzzleCompletedEvent extends GameEventBase {
  event_type: 'puzzle_completed'
  target_id: string // 퍼즐 ID
}

export type GameEvent = ClueAcquiredEvent | ZoneEnteredEvent | PuzzleCompletedEvent

export type GameEventType = GameEvent['event_type']

export const GAME_EVENT_TYPES: readonly GameEventType[] = [
  'clue_acquired',
  'zone_entered',
  'puzzle_completed',
]

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// 외부(JSON 등)에서 들어온 값을 검사한다. 계약에 맞지 않으면 null.
export function parseGameEvent(value: unknown): GameEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (
    !isNonEmptyString(record.event_id) ||
    !isNonEmptyString(record.target_id) ||
    !isNonEmptyString(record.source) ||
    !GAME_EVENT_TYPES.includes(record.event_type as GameEventType)
  ) {
    return null
  }
  return {
    event_id: record.event_id,
    event_type: record.event_type as GameEventType,
    target_id: record.target_id,
    source: record.source,
  }
}
