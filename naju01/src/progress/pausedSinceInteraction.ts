/**
 * 마지막으로 보낸 플레이어 상호작용 뒤 게임이 멈춰 있던 시간 — 동행 auto 턴에 실어 서버 무입력 판정(240초)에서 빼게 한다
 * (미르 11/11 「일시정지한 시간을 못 풀고 있는 시간으로 세면 안 된다. 그 시간만큼은 멈춰 있어야 한다」, backend npc_turn_api_v0.1).
 * 멈춘 시간 = 지난 실제 시간 − 지난 게임 시간. 게임 시계(gameNow)는 ESC 멈춤 메뉴 · 설정 · 소지품 · 시작 카드로 얼어 있던 시간을 뺀다.
 * 기준점은 서버가 상호작용을 받은 때(progressSync onSent). 이 페이지에서 아직 보낸 것이 없으면 페이지가 뜬 때부터 —
 * 그 전(새로 고침 · 로비에 다녀온 시간)은 모르니 빼지 않는다(서버 값 그대로).
 */
import { gameNow } from "@/engine/input/gameClock";

let realAt = performance.now();
let gameAt = gameNow();

/** 서버가 상호작용을 받았다 — 여기서부터 다시 잰다 */
export function noteInteractionSent() {
  realAt = performance.now();
  gameAt = gameNow();
}

/** 마지막 상호작용 뒤 멈춰 있던 시간(ms) */
export function pausedMsSinceInteraction(): number {
  return Math.max(0, Math.round(performance.now() - realAt - (gameNow() - gameAt)));
}
