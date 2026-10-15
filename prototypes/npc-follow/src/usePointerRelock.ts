import { useCallback, useEffect, useRef, useState } from 'react'

// 재요청 후 이 시간 안에 잠기지 않으면 실패로 보고 클릭 안내를 띄운다.
// 일부 브라우저는 requestPointerLock이 Promise를 돌려주지 않는다. (ms)
const RELOCK_TIMEOUT = 1000

function isPointerLocked(): boolean {
  return document.pointerLockElement !== null
}

// 실제 Pointer Lock 상태(document.pointerLockElement)를 추적하고,
// 대화 종료 후 재잠금 요청과 "화면 클릭" 안내 표시를 관리한다.
export function usePointerRelock(getTarget: () => HTMLElement | null | undefined) {
  const [locked, setLocked] = useState(isPointerLocked)
  // 안내가 필요한 상황이 생겼는지. 실제 표시 여부는 잠금 상태와 함께 판단한다.
  const [hintRequested, setHintRequested] = useState(false)
  const pending = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const stopPending = useCallback(() => {
    pending.current = false
    window.clearTimeout(timer.current)
  }, [])

  const fail = useCallback(() => {
    if (!pending.current) return
    stopPending()
    // 판정이 늦게 와도 그사이 잠겼다면 안내하지 않는다
    if (!isPointerLocked()) setHintRequested(true)
  }, [stopPending])

  useEffect(() => {
    // 잠금 상태는 이 이벤트로만 갱신한다 (키 입력·대화 종료에서 추측하지 않음)
    const onChange = () => {
      const now = isPointerLocked()
      setLocked(now)
      if (now) {
        stopPending()
        setHintRequested(false)
      }
    }
    document.addEventListener('pointerlockchange', onChange)
    document.addEventListener('pointerlockerror', fail)
    return () => {
      document.removeEventListener('pointerlockchange', onChange)
      document.removeEventListener('pointerlockerror', fail)
      window.clearTimeout(timer.current)
    }
  }, [stopPending, fail])

  // 클릭 핸들러 안에서 동기적으로 호출해야 한다 (브라우저는 사용자 입력 중에만 잠금을 허용).
  const requestRelock = useCallback(() => {
    // 이미 잠겨 있거나 요청이 진행 중이면 중복 요청하지 않는다
    if (pending.current || isPointerLocked()) return

    const target = getTarget()
    if (!target) {
      setHintRequested(true)
      return
    }

    pending.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fail, RELOCK_TIMEOUT)

    try {
      // 거부되면 Promise가 reject된다 (Promise가 없는 브라우저는 이벤트/시간 초과로 판정)
      Promise.resolve(target.requestPointerLock()).catch(fail)
    } catch {
      fail()
    }
  }, [getTarget, fail])

  // 재요청 없이 "화면을 클릭해 재개" 안내만 띄운다 (ESC 종료 등)
  const requestClickHint = useCallback(() => {
    if (!isPointerLocked()) setHintRequested(true)
  }, [])

  return {
    locked,
    showClickHint: hintRequested && !locked,
    requestRelock,
    requestClickHint,
  }
}
