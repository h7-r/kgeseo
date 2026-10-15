// NPC 행동 상태(Idle / Follow / Interact)와 전환 규칙.
// React·Three.js에 의존하지 않는 순수 모듈이라 게임 이벤트나 백엔드 명령도 같은 경로로 보낼 수 있다.
// 장애물에 막혀 기다리는 것은 행동 상태가 아니라 Follow 내부 상태(followLogic의 waiting)다.

export type NpcBehavior = 'Idle' | 'Follow' | 'Interact'

// 대화가 끝나면 돌아갈 수 있는 상태
export type NpcResumableBehavior = Exclude<NpcBehavior, 'Interact'>

export interface NpcBehaviorState {
  current: NpcBehavior
  // Interact 중일 때만 값이 있다: 대화 종료 시 복구할 상태
  resumeTo: NpcResumableBehavior | null
}

// source는 기록용 (예: 'debug-ui', 'dialog', 'game', 'backend')
export type NpcBehaviorEvent =
  | { type: 'START_FOLLOW'; source?: string }
  | { type: 'STOP_FOLLOW'; source?: string }
  | { type: 'START_INTERACT'; source?: string }
  | { type: 'END_INTERACT'; source?: string }

export type NpcBehaviorRejection =
  | 'already-in-state' // 이미 그 상태 (중복 명령)
  | 'busy-interacting' // 대화 중에는 동행 시작·중지를 받지 않는다
  | 'not-interacting' // 대화 중이 아닌데 대화 종료가 들어옴

export interface NpcBehaviorResult {
  accepted: boolean
  state: NpcBehaviorState
  previous: NpcBehaviorState
  reason?: NpcBehaviorRejection
}

// 초기 상태는 기존 동작과 같도록 Follow
export const INITIAL_BEHAVIOR_STATE: NpcBehaviorState = { current: 'Follow', resumeTo: null }

function reject(state: NpcBehaviorState, reason: NpcBehaviorRejection): NpcBehaviorResult {
  return { accepted: false, state, previous: state, reason }
}

function accept(previous: NpcBehaviorState, state: NpcBehaviorState): NpcBehaviorResult {
  return { accepted: true, state, previous }
}

// 전환 규칙. 허용되지 않는 이벤트는 상태를 바꾸지 않고 이유와 함께 거부한다.
export function reduceNpcBehavior(
  state: NpcBehaviorState,
  event: NpcBehaviorEvent,
): NpcBehaviorResult {
  switch (event.type) {
    case 'START_FOLLOW':
      if (state.current === 'Interact') return reject(state, 'busy-interacting')
      if (state.current === 'Follow') return reject(state, 'already-in-state')
      return accept(state, { current: 'Follow', resumeTo: null })

    case 'STOP_FOLLOW':
      if (state.current === 'Interact') return reject(state, 'busy-interacting')
      if (state.current === 'Idle') return reject(state, 'already-in-state')
      return accept(state, { current: 'Idle', resumeTo: null })

    case 'START_INTERACT':
      if (state.current === 'Interact') return reject(state, 'already-in-state')
      return accept(state, { current: 'Interact', resumeTo: state.current })

    case 'END_INTERACT':
      if (state.current !== 'Interact') return reject(state, 'not-interacting')
      return accept(state, { current: state.resumeTo ?? 'Follow', resumeTo: null })
  }
}

export type NpcBehaviorListener = (result: NpcBehaviorResult) => void

// 상태를 바꾸는 유일한 경로. dispatch는 동기적이라, 키·클릭 핸들러 안에서
// 결과(accepted)를 바로 확인하고 후속 처리(예: Pointer Lock)를 할 수 있다.
export interface NpcBehaviorStore {
  getState(): NpcBehaviorState
  dispatch(event: NpcBehaviorEvent): NpcBehaviorResult
  subscribe(listener: NpcBehaviorListener): () => void
}

// 외부(게임 이벤트·백엔드)에 노출하는 동행 명령 인터페이스
export interface NpcFollowCommands {
  startFollow(source?: string): NpcBehaviorResult
  stopFollow(source?: string): NpcBehaviorResult
}

export function createNpcBehaviorStore(
  initial: NpcBehaviorState = INITIAL_BEHAVIOR_STATE,
): NpcBehaviorStore {
  let state = initial
  const listeners = new Set<NpcBehaviorListener>()
  // 구독자 안에서 다시 dispatch해도(예: 대화 종료 시 보류 이벤트 처리) 상태는 즉시 바뀌고,
  // 알림은 앞선 알림이 모두 끝난 뒤 발생 순서대로 전달된다.
  const queue: NpcBehaviorResult[] = []
  let notifying = false
  return {
    getState: () => state,
    dispatch(event) {
      const result = reduceNpcBehavior(state, event)
      if (!result.accepted) return result
      state = result.state
      queue.push(result)
      if (!notifying) {
        notifying = true
        try {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const current = next
            listeners.forEach((listener) => listener(current))
          }
        } finally {
          notifying = false
        }
      }
      return result
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function createFollowCommands(store: NpcBehaviorStore): NpcFollowCommands {
  return {
    startFollow: (source) => store.dispatch({ type: 'START_FOLLOW', source }),
    stopFollow: (source) => store.dispatch({ type: 'STOP_FOLLOW', source }),
  }
}
