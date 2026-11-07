// 맞았을 때 「윽」 목소리 — 미르가 준 음원(public/sfx/hurt_*_1_eu_a.mp3, 2026-11-07). 맞은 사람의 성별로 고른다.
// 본편 효과음 음량(getSfxGraph 출력)을 따른다. 3단계에서는 본편 소리 목록(src/audio/sound.ts SOUND_FILES)에 정식으로 올린다.
// 여러 명이 한꺼번에 맞아도 너무 커지지 않게 동시에 3개까지만.
import { getSfxGraph } from "@/audio/sound";

const URLS = {
  feminine: "/sfx/hurt_female_1_eu_a.mp3",
  masculine: "/sfx/hurt_male_1_eu_a.mp3",
} as const;
export type HurtGender = keyof typeof URLS;

const MAX_AT_ONCE = 3;
let playing = 0;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function load(ctx: AudioContext, url: string) {
  let pending = buffers.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    buffers.set(url, pending);
  }
  return pending;
}

/** 미리 받아 둔다(처음 맞을 때 늦게 나오지 않게) */
export function preloadHurtVoices() {
  const graph = getSfxGraph();
  if (!graph) return;
  for (const url of Object.values(URLS)) void load(graph.ctx, url);
}

/** volume 0~1(거리로 줄인 값) */
export function playHurtVoice(gender: HurtGender, volume = 1) {
  if (volume <= 0.02 || playing >= MAX_AT_ONCE) return;
  const graph = getSfxGraph();
  if (!graph) return;
  const { ctx, output } = graph;
  playing += 1;
  void load(ctx, URLS[gender]).then((buffer) => {
    if (!buffer) {
      playing = Math.max(0, playing - 1);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(output);
    source.onended = () => {
      playing = Math.max(0, playing - 1);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  });
}
