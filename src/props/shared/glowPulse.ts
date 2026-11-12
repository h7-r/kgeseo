/**
 * 「지금 여기를 만져라」 맥박 — 빛무리(GlowHalo)와 손잡이 발광(AimHighlight pulse)이 같은 위상으로 숨쉰다.
 * 소화전 밸브(미르 11/10)에서 시작해 관창 · 관창 구멍 · 객차 조명 시험반이 같은 빛을 쓴다(11/12).
 */

/** 맥박 주기(초) — 「지금」으로 읽히게 조금 빠르게 */
const PULSE_SECONDS = 1.2;

/** 빛무리 기본값 — 스프라이트 전체 폭(미터, 가장자리는 투명) · 색 · 불투명도 범위. 파랑은 안 쓴다(전류 연출과 헷갈린다) */
export const GLOW_HALO = {
  size: [0.75, 1.05] as const,
  color: "#ffb53a",
  opacity: [0.55, 1] as const,
};

/** 맥박 0~1 */
export const pulseWave = () => 0.5 + 0.5 * Math.sin((performance.now() / 1000) * ((Math.PI * 2) / PULSE_SECONDS));

/** 만질 수 있는 동안 0.35~1 로 숨쉬는 발광 세기 — AimHighlight 의 pulse 에 그대로 준다 */
export const attentionPulse = (isOn: () => boolean) => () => (isOn() ? 0.35 + 0.65 * pulseWave() : 0);
