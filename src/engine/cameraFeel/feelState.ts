/**
 * 카메라 손맛 — 나주맵 몰입 연출(naju01/src/scene/immersion/director.ts)의 「흔들림(트라우마)」을 실내에 맞춰 옮겼다.
 * 충격이 쌓이면(addTrauma) 0~1 의 트라우마가 되고, 흔들림은 그 제곱에 비례해 금방 잦아든다.
 * 비·물튀김·구역 안개는 야외 연출이라 옮기지 않는다.
 */
import { onSoundPlayed, type SoundName } from "@/audio/sound";

export const cameraFeel = {
  /** 0~1. 1초에 0.8 씩 줄어든다 */
  trauma: 0,
};

/** 충격을 더한다. 0.2 = 툭, 0.5 = 쿵(자판기가 밀려나는 정도) */
export function addTrauma(amount: number) {
  cameraFeel.trauma = Math.min(1, cameraFeel.trauma + amount);
}

/**
 * 몸으로 느낄 만한 소리만 화면을 흔든다 — 퍼즐 코드를 고치지 않고 한곳에서 정한다.
 * 버튼·다이얼·종이처럼 손끝 소리는 뺀다. 값은 소리 크기(volume)에 곱한다.
 */
const SOUND_IMPACT: Partial<Record<SoundName, number>> = {
  vendingOff: 0.55, // 밸브가 풀려 자판기가 밀려난다
  lockOpen: 0.2,
  boxDown: 0.16, // 작업등·선을 꽂고 차단기를 올린다
  locked: 0.12,
  trainOpen: 0.22,
  trainClose: 0.28,
  drawerClose: 0.1,
  canDrop: 0.08,
};

onSoundPlayed((name, volume) => {
  const impact = SOUND_IMPACT[name];
  if (impact) addTrauma(impact * Math.min(1, volume));
});

// 부드러운 잡음(삼각함수 합) — 무작위보다 덜 어지럽다(나주와 같은 식)
export const smoothNoise = (t: number, seed: number) =>
  Math.sin(t + seed) * 0.55 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.13 + seed * 2.9) * 0.15;
