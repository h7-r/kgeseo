/**
 * 마지막으로 보낸 플레이어 상호작용 뒤 게임이 멈춰 있던 시간 — 동행 auto 턴에 실어 서버 무입력 판정(240초)에서 빼게 한다
 * (미르 11/11 「일시정지한 시간을 못 풀고 있는 시간으로 세면 안 된다. 그 시간만큼은 멈춰 있어야 한다」, backend npc_turn_api_v0.1).
 * 멈춘 시간 = 지난 실제 시간 − 지난 게임 시간. 게임 시계(gameNow)는 ESC 멈춤 메뉴 · 설정 · 소지품 · 시작 카드로 얼어 있던 시간을 뺀다.
 * 기준점은 서버가 받은 상호작용을 처음 보낸 때(progressSync markSend → onSent). 응답을 잃고 나중에 다시 보내도 처음 표시를 쓴다 —
 * 서버 기록은 처음 받은 때라서(14회차 Codex). 더 오래된 상호작용이 늦게 성공해도 기준점을 뒤로 돌리지 않는다.
 * 이 페이지에서 아직 보낸 것이 없으면 페이지가 뜬 때부터 — 그 전(새로 고침 · 로비에 다녀온 시간)은 모르니 빼지 않는다(서버 값 그대로).
 */
import { gameNow } from "@/engine/input/gameClock";

interface SendMark {
  realAt: number;
  gameAt: number;
}

let base: SendMark = { realAt: performance.now(), gameAt: gameNow() };

/** 상호작용을 처음 보낼 때 찍는다 */
export const markInteractionSend = (): SendMark => ({ realAt: performance.now(), gameAt: gameNow() });

const isSendMark = (value: unknown): value is SendMark =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SendMark).realAt === "number" &&
  typeof (value as SendMark).gameAt === "number";

/** 서버가 상호작용을 받았다 — 그 상호작용을 처음 보낸 때부터 다시 잰다(표시가 없으면 지금부터) */
export function noteInteractionSent(mark?: unknown) {
  const next = isSendMark(mark) ? mark : markInteractionSend();
  if (next.realAt >= base.realAt) base = next;
}

/** 마지막 상호작용 뒤 멈춰 있던 시간(ms) */
export function pausedMsSinceInteraction(): number {
  return Math.max(0, Math.round(performance.now() - base.realAt - (gameNow() - base.gameAt)));
}
