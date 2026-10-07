import { useCallback, useRef, useState } from "react";

/**
 * 제출이 끝날 때까지 다시 누르지 못하게 잠근다.
 * isSubmitting 상태는 다음 렌더에야 바뀌어 빠른 두 번째 누름을 못 막으므로 잠금은 ref 로 건다.
 */
export function useSubmitLock() {
  const lockedRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setIsSubmitting(true);
    try {
      await task();
    } finally {
      lockedRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, run };
}
