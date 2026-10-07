import { useCallback, useEffect, useRef, useState } from "react";

import type { IconName } from "./PlayerIcon";

const TOAST_DURATION = 700;

interface Toast {
  icon: IconName;
  text: string;
  id: number;
}

/** "+2초" "소리 60%" 같은 표시를 가운데 잠깐 띄운다. */
export function useToast() {
  const toastTimerRef = useRef(0);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((icon: IconName, text: string) => {
    clearTimeout(toastTimerRef.current);
    setToast({ icon, text, id: Date.now() });
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  return { toast, showToast };
}
