/** 입력칸(로비 채팅 등)에 커서가 있나 — 그동안은 잠금이 풀려 있어도 「게임 밖」이 아니다(게임 밖 [T] 안내, 튜토피드백 12회차) */
import { useSyncExternalStore } from "react";

import { isTypingTarget } from "@/game/overlayLayer";

function subscribe(onChange: () => void) {
  // focusout 순간에는 아직 옮겨 가는 중이다 — 다 옮겨 간 뒤에 읽는다
  const handle = () => window.setTimeout(onChange, 0);
  document.addEventListener("focusin", handle);
  document.addEventListener("focusout", handle);
  return () => {
    document.removeEventListener("focusin", handle);
    document.removeEventListener("focusout", handle);
  };
}

const isTypingNow = () => typeof document !== "undefined" && isTypingTarget(document.activeElement);

export const useIsTypingFocused = () => useSyncExternalStore(subscribe, isTypingNow, () => false);
