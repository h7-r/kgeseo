import { useCallback, useEffect, useRef, useState } from 'react'
import { INTERACTION_CONFIG } from './interaction'
import type { NpcDialogEndReason, NpcInteractionPhase } from './interaction'

interface UseNpcInteractionOptions {
  // false면 조준해도 대화를 시작하지 않는다 (예: 3인칭 관찰 모드)
  enabled: boolean
  // 대화가 실제로 끝난 순간 한 번 호출된다 (닫기 버튼·ESC 공통).
  // 끝내게 만든 입력의 이벤트 핸들러 안에서 동기적으로 불리므로 Pointer Lock 재요청에 쓸 수 있다.
  onEnd?: (reason: NpcDialogEndReason) => void
}

// 대화 상태와 E/ESC 키 입력을 관리한다. NPC 이동 상태는 다루지 않는다.
export function useNpcInteraction({ enabled, onEnd }: UseNpcInteractionOptions) {
  const [phase, setPhase] = useState<NpcInteractionPhase>('idle')
  const [canInteract, setCanInteract] = useState(false)

  // 키 이벤트에서 최신 값을 동기적으로 읽기 위한 사본 (같은 입력이 두 번 처리되지 않게)
  const phaseRef = useRef<NpcInteractionPhase>('idle')
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
    if (
      phaseRef.current !== 'idle' ||
      !canInteractRef.current ||
      !enabledRef.current
    ) {
      return
    }
    phaseRef.current = 'talking'
    setPhase('talking')
    canInteractRef.current = false
    setCanInteract(false)
    // 대화창 버튼을 누를 수 있도록 마우스 잠금을 푼다
    if (document.pointerLockElement) document.exitPointerLock()
  }, [])

  const endTalk = useCallback((reason: NpcDialogEndReason) => {
    if (phaseRef.current !== 'talking') return
    phaseRef.current = 'idle'
    setPhase('idle')
    onEndRef.current?.(reason)
  }, [])

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
    phase,
    talking: phase === 'talking',
    canInteract: canInteract && enabled && phase === 'idle',
    reportTarget,
    startTalk,
    endTalk,
  }
}
