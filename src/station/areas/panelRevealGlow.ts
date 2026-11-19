/**
 * 「맞은편 배전반도 열렸다」 알림 동안 배전반이 스스로 빛난다 — 완전 전원 전에는 그 자리가 깜깜해 화면이 돌아가도
 * 아무것도 안 보였다(미르 11/9 「내 눈으로는 확인을 못했다」, 튜토피드백 12회차). 겨냥 강조와 같은 발광(AimHighlight pulse)을
 * 0.9초 주기로 숨 쉬게 하고 끝에서 천천히 끈다. 시간은 게임 시계와 같은 기준(벽시계)으로 — 연출 길이가 몇 초뿐이다.
 */
const PULSE_SECONDS = 0.9;
const FADE_SECONDS = 1;

let glowFrom = -Infinity;
let glowUntil = -Infinity;

/** 지금부터 seconds 동안 빛낸다 */
export function startPanelRevealGlow(seconds: number) {
  const now = performance.now() / 1000;
  glowFrom = now;
  glowUntil = now + seconds;
}

/** 0~1 — WallCabinet 이 매 프레임 읽는다 */
export function readPanelRevealGlow() {
  const now = performance.now() / 1000;
  if (now < glowFrom || now > glowUntil) return 0;
  const fade = Math.min(1, (glowUntil - now) / FADE_SECONDS);
  const breath = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin((now - glowFrom) * ((Math.PI * 2) / PULSE_SECONDS)));
  return breath * fade;
}
