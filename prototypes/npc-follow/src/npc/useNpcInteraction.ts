import { useCallback, useEffect, useRef, useState } from 'react'
import { INTERACTION_CONFIG } from './interaction'
import type { NpcDialogEndReason } from './interaction'
import type { NpcBehaviorStore } from './behaviorState'
import { useNpcBehavior } from './useNpcBehavior'

interface UseNpcInteractionOptions {
  // 행동 상태 저장소. 대화 시작·종료는 이 저장소의 Interact 전환으로만 처리한다.
  store: NpcBehaviorStore
  // false면 조준해도 대화를 시작하지 않는다 (예: 3인칭 관찰 모드)
  enabled: boolean
  // 대화가 실제로 끝난 순간 한 번 호출된다 (닫기 버튼·ESC 공통).
  // 끝내게 만든 입력의 이벤트 핸들러 안에서 동기적으로 불리므로 Pointer Lock 재요청에 쓸 수 있다.
  onEnd?: (reason: NpcDialogEndReason) => void
}

// 조준 판정과 E/ESC 키 입력을 행동 상태(Interact) 전환으로 연결한다. NPC 이동은 다루지 않는다.
export function useNpcInteraction({ store, enabled, onEnd }: UseNpcInteractionOptions) {
  const behavior = useNpcBehavior(store)
  const talking = behavior.current === 'Interact'
  const [canInteract, setCanInteract] = useState(false)

  // 키 이벤트에서 최신 값을 동기적으로 읽기 위한 사본
  const canInteractRef = useRef(false)
  const enabledRef = useRef(enabled)
  const onEndRef = useRef(onEnd)

  useEffect(() => {
    enabledRef.current = enabled
    onEndRef.current = onEnd
  }, [enabled, onEnd])

  // 조준 감지기(NpcInteractionSensor)가 판정이 바뀔 때만 호출한다
  const reportTarget = useCallback((targetable: boolean) => {
    canInteractRef.current = targetable
    setCanInteract(targetable)
  }, [])

  const startTalk = useCallback(() => {
    if (!canInteractRef.current || !enabledRef.current) return
    // 이미 대화 중이면 저장소가 거부한다 (중복 입력 방지)
    if (!store.dispatch({ type: 'START_INTERACT', source: 'dialog' }).accepted) return
    canInteractRef.current = false
    setCanInteract(false)
    // 대화창 버튼을 누를 수 있도록 마우스 잠금을 푼다
    if (document.pointerLockElement) document.exitPointerLock()
  }, [store])

  const endTalk = useCallback(
    (reason: NpcDialogEndReason) => {
      // 대화 중이 아니면 거부되므로 onEnd(재잠금 등)가 두 번 실행되지 않는다
      if (!store.dispatch({ type: 'END_INTERACT', source: 'dialog' }).accepted) return
      onEndRef.current?.(reason)
    },
    [store],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.code === INTERACTION_CONFIG.talkKey) startTalk()
      else if (event.code === INTERACTION_CONFIG.closeKey) endTalk('key')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [startTalk, endTalk])

  return {
    behavior,
    talking,
    canInteract: canInteract && enabled && !talking,
    reportTarget,
    startTalk,
    endTalk,
  }
}
