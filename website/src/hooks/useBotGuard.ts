import { useState } from "react";

// 봇으로 보이면 어디서 걸렸는지 알려 주지 않는다.
export const BOT_SUSPECTED_MESSAGE = "잠시 후 다시 시도해 주세요.";
// 봇은 화면이 뜨자마자 모든 칸을 채워 제출한다.
const MIN_FILL_TIME_MS = 1500;

/** 봇 막기: 숨은 칸(honeypot)이 채워졌거나 화면이 뜨고 너무 빨리 제출했는지 본다. */
export function useBotGuard() {
  const [honeypot, setHoneypot] = useState("");
  const [mountedAt] = useState(() => Date.now());
  const isLikelyBot = () => Boolean(honeypot) || Date.now() - mountedAt < MIN_FILL_TIME_MS;
  return { honeypot, setHoneypot, isLikelyBot };
}
