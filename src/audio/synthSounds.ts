/**
 * 파일 없이 합성하는 소리 — 치지직거리는 전류와 종이컵을 홀짝이는 소리.
 * 맞는 효과음 파일이 없어도 전류 세기를 매 프레임 그대로 소리에 실을 수 있다.
 */
import { createLehmerRandom } from "@/engine/random";

import { getSfxGraph } from "./sound";

/** 전류 한 바퀴(초) — 이어 틀어도 박자가 안 들리게 불꽃 자리는 무작위다 */
const CRACKLE_SECONDS = 2.4;

let crackleBuffer: AudioBuffer | null = null;

function buildCrackleBuffer(ctx: AudioContext) {
  if (crackleBuffer) return crackleBuffer;
  const length = Math.floor(ctx.sampleRate * CRACKLE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = createLehmerRandom(4817);
  for (let i = 0; i < length; i++) {
    // 낮게 웅웅대는 전기 + 아주 옅은 지글거림
    const time = i / ctx.sampleRate;
    data[i] = Math.sign(Math.sin(time * Math.PI * 2 * 118)) * 0.05 + (random() - 0.5) * 0.05;
  }
  // 불꽃 — 짧게 터지는 잡음. 길이와 세기가 제각각이어야 치지직으로 들린다
  const sparks = 150;
  for (let k = 0; k < sparks; k++) {
    const start = Math.floor(random() * length);
    const span = Math.floor(ctx.sampleRate * (0.002 + random() * random() * 0.03));
    const power = 0.25 + random() * 0.75;
    for (let i = 0; i < span; i++) {
      const at = (start + i) % length;
      data[at] += (random() - 0.5) * 2 * power * (1 - i / span);
    }
  }
  crackleBuffer = buffer;
  return buffer;
}

interface CrackleVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  /** 마지막으로 건 목표 — 같은 값이면 다시 걸지 않는다 */
  level: number;
  surge: number;
  /** 마지막으로 소리가 나던 시각(AudioContext 시간) */
  audibleAt: number;
}
let crackle: CrackleVoice | null = null;

const SILENT_LEVEL = 0.001;
/** 이만큼(초) 무음이 이어지면 소스를 멈춘다 — 게인이 충분히 잦아든 뒤다 */
const CRACKLE_RELEASE_SECONDS = 1;

/** 전류 소리 세기 0~1 · 그림에 닿는 순간처럼 세질 때 surge 0~1. 매 프레임 불러도 된다 */
export function setElectricSound(level: number, surge = 0) {
  if (level <= SILENT_LEVEL && !crackle) return;
  const graph = getSfxGraph();
  if (!graph) return;
  const { ctx, output } = graph;
  const now = ctx.currentTime;
  if (!crackle) {
    const source = ctx.createBufferSource();
    source.buffer = buildCrackleBuffer(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(output);
    source.start();
    crackle = { source, gain, filter, level: -1, surge: -1, audibleAt: now };
  }
  if (level > SILENT_LEVEL) {
    crackle.audibleAt = now;
  } else if (now - crackle.audibleAt >= CRACKLE_RELEASE_SECONDS) {
    crackle.source.stop();
    crackle.gain.disconnect();
    crackle = null;
    return;
  }
  if (level === crackle.level && surge === crackle.surge) return;
  crackle.level = level;
  crackle.surge = surge;
  crackle.gain.gain.setTargetAtTime(level * (0.55 + surge * 0.75), now, 0.05);
  // 세지면 낮은 쪽까지 터지고 조금 빨라져 힘이 실린 소리가 된다
  crackle.filter.frequency.setTargetAtTime(900 - surge * 720, now, 0.08);
  crackle.source.playbackRate.setTargetAtTime(1 + surge * 0.3, now, 0.08);
}

let sipBuffer: AudioBuffer | null = null;

function buildSipBuffer(ctx: AudioContext) {
  const seconds = 0.62;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = createLehmerRandom(90217);
  let smooth = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const time = i / ctx.sampleRate;
    // 후루룩 — 숨을 들이켜는 작은 바람 소리가 살짝 떨린다
    smooth += ((random() - 0.5) * 2 - smooth) * 0.16;
    const sip = t < 0.55 ? Math.sin((t / 0.55) * Math.PI) ** 1.5 : 0;
    const flutter = 0.72 + 0.28 * Math.sin(time * Math.PI * 2 * 21);
    // 꿀꺽 — 끝에서 낮은 음이 한 번 떨어진다
    const gulp = t > 0.62 ? Math.sin(((t - 0.62) / 0.38) * Math.PI) : 0;
    const pitch = 165 - (t - 0.62) * 150;
    data[i] = smooth * sip * flutter * 0.55 + Math.sin(time * Math.PI * 2 * pitch) * gulp * 0.22;
  }
  return buffer;
}

/** 종이컵을 홀짝이는 작은 소리 — 조용한 복도에서 들릴 듯 말 듯하게 */
export function playCupSip(volume = 0.3) {
  const graph = getSfxGraph();
  if (!graph) return;
  const { ctx, output } = graph;
  sipBuffer ??= buildSipBuffer(ctx);
  const source = ctx.createBufferSource();
  source.buffer = sipBuffer;
  source.playbackRate.value = 0.94 + Math.random() * 0.12;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(output);
  source.start();
}
