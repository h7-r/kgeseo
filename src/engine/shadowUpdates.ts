// three 는 기본으로 매 프레임 그림자 맵을 통째로 다시 그린다(본부실 한 프레임의 55%).
// 자동 갱신을 끄고, 무언가 움직였다는 신호가 오면 잠깐 촘촘히, 그 밖에는 느린 안전망 주기로만 다시 그린다.
// 신호는 여러 소품이 보내고 ShadowMapUpdater(rendering.tsx)가 받는다.
let shadowUrgentUntil = 0;

const nowSeconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** 무언가 움직였다 — 이 시간(초) 동안 그림자를 촘촘히 다시 그린다. 안 불러도 안전망이 늦게라도 따라온다. */
export function requestShadowUpdates(seconds = 1.5) {
  shadowUrgentUntil = Math.max(shadowUrgentUntil, nowSeconds() + seconds);
}

/** 지금이 신호를 받은 촘촘한 갱신 구간인지 */
export function isShadowUpdateUrgent() {
  return nowSeconds() < shadowUrgentUntil;
}
