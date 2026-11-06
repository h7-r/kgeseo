// 둔탁한 타격음 — 음원 파일 없이 WebAudio 로 만든다(낮게 떨어지는 사인 「퍽」 + 짧은 저역 잡음).
// 본편 효과음 음량(getSfxGraph 출력)을 따른다. 사운드 작업물이 나오면 playThud 안만 playSound 로 바꾸면 된다.
// 여러 명이 한꺼번에 때려도 너무 커지지 않게 동시에 4개까지만, 끝나면 노드를 끊는다.
import { getSfxGraph } from "@/audio/sound";

const MAX_AT_ONCE = 4;
let playing = 0;
let noise: AudioBuffer | null = null;

function noiseBuffer(ctx: AudioContext) {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const length = Math.floor(ctx.sampleRate * 0.12);
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  return noise;
}

/** volume 0~1(거리로 줄인 값) */
export function playThud(volume = 1) {
  if (volume <= 0.02 || playing >= MAX_AT_ONCE) return;
  const graph = getSfxGraph();
  if (!graph) return;
  const { ctx, output } = graph;
  const t = ctx.currentTime;
  playing += 1;

  // 몸통: 140Hz → 45Hz 로 빠르게 떨어지는 사인
  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(140, t);
  body.frequency.exponentialRampToValueAtTime(45, t + 0.16);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.9 * volume, t + 0.006);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  body.connect(bodyGain).connect(output);

  // 닿는 소리: 짧은 잡음을 저역으로 걸러 「퍽」
  const hit = ctx.createBufferSource();
  hit.buffer = noiseBuffer(ctx);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(900, t);
  const hitGain = ctx.createGain();
  hitGain.gain.setValueAtTime(0.5 * volume, t);
  hitGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  hit.connect(lowpass).connect(hitGain).connect(output);

  body.start(t);
  body.stop(t + 0.25);
  hit.start(t);
  hit.stop(t + 0.12);
  body.onended = () => {
    playing = Math.max(0, playing - 1);
    body.disconnect();
    bodyGain.disconnect();
    hit.disconnect();
    lowpass.disconnect();
    hitGain.disconnect();
  };
}
