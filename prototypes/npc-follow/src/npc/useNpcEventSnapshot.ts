import { useCallback, useSyncExternalStore } from 'react'
import type { NpcEventController, NpcEventControllerSnapshot } from './npcEventController'

// 이벤트 컨트롤러의 보류 목록·처리 결과를 화면에 연결한다 (읽기 전용)
export function useNpcEventSnapshot(controller: NpcEventController): NpcEventControllerSnapshot {
  const subscribe = useCallback(
    (onChange: () => void) => controller.subscribe(onChange),
    [controller],
  )
  return useSyncExternalStore(subscribe, controller.getSnapshot)
}
