import { useCallback, useSyncExternalStore } from 'react'
import type { NpcBehaviorState, NpcBehaviorStore } from './behaviorState'

// 행동 상태 저장소를 React 화면에 연결한다 (읽기 전용). 상태 변경은 store.dispatch로만 한다.
export function useNpcBehavior(store: NpcBehaviorStore): NpcBehaviorState {
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(() => onChange()),
    [store],
  )
  return useSyncExternalStore(subscribe, store.getState)
}
