// 게임 이벤트 → NPC 행동 상태 명령으로 바꾸는 컨트롤러. React·Three.js 의존성 없음.
// (Node 단위 테스트에서 바로 불러올 수 있도록 같은 폴더 모듈을 .ts 확장자로 가져온다)
import { createFollowCommands } from './behaviorState.ts'
import type { NpcBehaviorResult, NpcBehaviorStore } from './behaviorState.ts'
import { parseGameEvent } from './gameEvents.ts'
import type { GameEvent, GameEventType } from './gameEvents.ts'

export type NpcEventAction = 'START_FOLLOW' | 'STOP_FOLLOW'

// 이벤트 종류 + 대상 ID 조합마다 NPC 반응을 정한다
export interface NpcEventRule {
  event_type: GameEventType
  target_id: string
  action: NpcEventAction
}

// 프로토타입 테스트용 규칙
export const DUMMY_EVENT_RULES: readonly NpcEventRule[] = [
  { event_type: 'clue_acquired', target_id: 'test_clue_01', action: 'STOP_FOLLOW' },
  { event_type: 'puzzle_completed', target_id: 'test_puzzle_01', action: 'START_FOLLOW' },
  { event_type: 'zone_entered', target_id: 'test_zone_01', action: 'STOP_FOLLOW' },
]

export type NpcEventStatus = 'applied' | 'deferred' | 'ignored'

export type NpcEventIgnoreReason =
  | 'invalid' // 계약에 맞지 않는 데이터
  | 'duplicate' // 이미 받은 event_id
  | 'no-rule' // 정의되지 않은 이벤트 종류·대상 조합
  | 'no-change' // 이미 그 행동 상태
  | 'superseded' // 대화 중 보류됐다가 같은 대상(동행 모드)의 더 나중 이벤트로 대체됨

export interface NpcEventResult {
  seq: number // 컨트롤러가 받은 순서 (보류 처리 순서의 기준)
  status: NpcEventStatus
  reason?: NpcEventIgnoreReason
  event: GameEvent | null
  action?: NpcEventAction
  behavior?: NpcBehaviorResult
  // immediate = 받은 즉시 처리, flush = 대화 종료 후 보류분 처리
  phase: 'immediate' | 'flush'
}

export interface NpcEventControllerSnapshot {
  pending: readonly GameEvent[] // 대화 종료를 기다리는 이벤트 (받은 순서)
  log: readonly NpcEventResult[] // 최근 처리 결과 (최신이 마지막)
}

export interface NpcEventController {
  handle(input: unknown): NpcEventResult
  getSnapshot(): NpcEventControllerSnapshot
  subscribe(listener: () => void): () => void
  dispose(): void
}

export interface NpcEventControllerOptions {
  rules?: readonly NpcEventRule[]
  logLimit?: number // 디버그용으로 남길 결과 수
  seenLimit?: number // 중복 판정용으로 기억할 event_id 수
}

// 같은 채널에 속한 명령은 서로 덮어쓴다. 지금은 모든 규칙이 '동행 모드' 하나를 바꾼다.
// 이후 다른 종류의 반응(예: 등장·위치 이동)이 생기면 별도 채널로 두어 서로 대체되지 않게 한다.
function channelOf(action: NpcEventAction): string {
  switch (action) {
    case 'START_FOLLOW':
    case 'STOP_FOLLOW':
      return 'follow-mode'
  }
}

interface PendingItem {
  seq: number
  event: GameEvent
  action: NpcEventAction
}

export function createNpcEventController(
  store: NpcBehaviorStore,
  { rules = DUMMY_EVENT_RULES, logLimit = 20, seenLimit = 500 }: NpcEventControllerOptions = {},
): NpcEventController {
  const commands = createFollowCommands(store)
  const ruleMap = new Map(rules.map((r) => [`${r.event_type}:${r.target_id}`, r]))
  const seen = new Set<string>()
  let pending: PendingItem[] = []
  let log: NpcEventResult[] = []
  let seq = 0
  let snapshot: NpcEventControllerSnapshot = { pending: [], log: [] }
  const listeners = new Set<() => void>()

  const publish = () => {
    snapshot = { pending: pending.map((p) => p.event), log }
    listeners.forEach((listener) => listener())
  }

  const record = (result: NpcEventResult): NpcEventResult => {
    log = [...log, result].slice(-logLimit)
    return result
  }

  const remember = (eventId: string) => {
    seen.add(eventId)
    // 오래된 ID부터 잊는다 (Set은 넣은 순서를 유지)
    if (seen.size > seenLimit) seen.delete(seen.values().next().value as string)
  }

  const apply = (
    itemSeq: number,
    event: GameEvent,
    action: NpcEventAction,
    phase: NpcEventResult['phase'],
  ): NpcEventResult => {
    const source = `event:${event.event_type}:${event.event_id}`
    const behavior =
      action === 'START_FOLLOW' ? commands.startFollow(source) : commands.stopFollow(source)
    return record({
      seq: itemSeq,
      status: behavior.accepted ? 'applied' : 'ignored',
      reason: behavior.accepted ? undefined : 'no-change',
      event,
      action,
      behavior,
      phase,
    })
  }

  // 대화 종료 후 보류 이벤트 처리.
  // 같은 채널 안에서는 받은 순서상 마지막 이벤트만 적용하고 앞선 것은 superseded로 기록한다.
  // (동행 모드는 '최종 상태'만 의미가 있어, 전부 차례로 적용하면 같은 프레임에 Idle·Follow가
  //  번갈아 바뀔 뿐 결과는 마지막과 같다.) 채널 사이의 처리 순서는 받은 순서를 따른다.
  const flush = () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    const lastInChannel = new Map<string, number>()
    batch.forEach((item) => lastInChannel.set(channelOf(item.action), item.seq))
    for (const item of batch) {
      if (lastInChannel.get(channelOf(item.action)) === item.seq) {
        apply(item.seq, item.event, item.action, 'flush')
      } else {
        record({
          seq: item.seq,
          status: 'ignored',
          reason: 'superseded',
          event: item.event,
          action: item.action,
          phase: 'flush',
        })
      }
    }
    publish()
  }

  // 대화(Interact)가 끝나 다른 상태로 바뀌는 순간 보류분을 처리한다
  const unsubscribe = store.subscribe((result) => {
    if (result.previous.current === 'Interact' && result.state.current !== 'Interact') flush()
  })

  return {
    handle(input) {
      const itemSeq = ++seq
      const event = parseGameEvent(input)
      let result: NpcEventResult
      if (!event) {
        result = record({ seq: itemSeq, status: 'ignored', reason: 'invalid', event: null, phase: 'immediate' })
      } else if (seen.has(event.event_id)) {
        result = record({ seq: itemSeq, status: 'ignored', reason: 'duplicate', event, phase: 'immediate' })
      } else {
        remember(event.event_id)
        const rule = ruleMap.get(`${event.event_type}:${event.target_id}`)
        if (!rule) {
          result = record({ seq: itemSeq, status: 'ignored', reason: 'no-rule', event, phase: 'immediate' })
        } else if (store.getState().current === 'Interact') {
          // 대화 중 동행 명령은 저장소가 거부하므로 여기서 보류한다
          pending = [...pending, { seq: itemSeq, event, action: rule.action }]
          result = record({ seq: itemSeq, status: 'deferred', event, action: rule.action, phase: 'immediate' })
        } else {
          result = apply(itemSeq, event, rule.action, 'immediate')
        }
      }
      publish()
      return result
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      unsubscribe()
      listeners.clear()
    },
  }
}
