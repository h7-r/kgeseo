// 캐릭터 목소리 — 인사·주먹·점프·맞기(2026-11-07 미르: 「음성 모음집을 우리 애니메이션에 맞게」, 검토 15회차).
// 음원: ElevenLabs 대사 모음(~/Downloads/사람 효과음 모임, 여 Yeonhee · 남 Jun Ho)과 「윽」(hurt_*). public/sfx/voice_*.mp3.
// 본편 효과음 음량(getSfxGraph 출력)을 따른다. 3단계에서 본편 소리 목록(src/audio/sound.ts)으로 옮긴다.
//
// 크기: 파일마다 잰 통합 음량(ffmpeg ebur128, LUFS)으로 모두 VOICE_TARGET_LUFS 에 맞춘다 — 대사는 −16.4 로 정규화돼
// 있지만 「헛」「윽」 은 −17.5~−18.8 이라 같은 배율이면 들쭉날쭉하다. 뛰기 발소리(run 루프)는 이보다 약 7dB 아래(useMovement).
// 규칙:
//   · 동시에 3개까지. 같은 사람이 새로 말하면 이전 목소리를 끊는다 — 단 우선순위가 낮은 것은 높은 것을 못 끊는다
//     (「윽」 은 인사를 끊지만 인사가 「윽」 을 덮지는 않는다).
//   · 숨긴 사람의 목소리는 안 내고, 숨기는 순간 재생·불러오는 중인 것도 끊는다(silenceSpeaker).
import { getSfxGraph } from "@/audio/sound";

export type VoiceGender = "feminine" | "masculine";
export type VoiceKind = "greet" | "joy" | "move" | "threat" | "jump" | "hurt";

/** 맞출 크기(마스터 효과음 크기를 곱하기 전) */
export const VOICE_TARGET_LUFS = -20.5;

/** 파일과 잰 통합 음량(LUFS, 2026-11-07) */
const FILES: Readonly<Record<VoiceKind, Readonly<Record<VoiceGender, { url: string; lufs: number }>>>> = {
  greet: {
    feminine: { url: "/sfx/voice_female_greet.mp3", lufs: -16.4 },
    masculine: { url: "/sfx/voice_male_greet.mp3", lufs: -16.4 },
  },
  // 남자는 a 후보(Jun Ho — 다른 대사와 같은 목소리). b(Ian)를 고르면 파일만 바꾼다
  joy: {
    feminine: { url: "/sfx/voice_female_joy.mp3", lufs: -16.4 },
    masculine: { url: "/sfx/voice_male_joy.mp3", lufs: -16.4 },
  },
  move: {
    feminine: { url: "/sfx/voice_female_move.mp3", lufs: -16.4 },
    masculine: { url: "/sfx/voice_male_move.mp3", lufs: -16.4 },
  },
  threat: {
    feminine: { url: "/sfx/voice_female_threat.mp3", lufs: -16.4 },
    masculine: { url: "/sfx/voice_male_threat.mp3", lufs: -16.4 },
  },
  jump: {
    feminine: { url: "/sfx/voice_female_jump.mp3", lufs: -17.9 },
    masculine: { url: "/sfx/voice_male_jump.mp3", lufs: -18.8 },
  },
  hurt: {
    feminine: { url: "/sfx/hurt_female_1_eu_a.mp3", lufs: -17.5 },
    masculine: { url: "/sfx/hurt_male_1_eu_a.mp3", lufs: -18.7 },
  },
};

/** 우선순위 — 높은 것이 같은 사람의 낮은 것을 끊는다 */
const PRIORITY: Readonly<Record<VoiceKind, number>> = { greet: 1, joy: 1, move: 1, jump: 1, threat: 2, hurt: 3 };
const MAX_AT_ONCE = 3;

/** 맞출 크기까지의 배율 */
export const voiceGain = (lufs: number) => 10 ** ((VOICE_TARGET_LUFS - lufs) / 20);

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

/** 미리 받아 둔다(처음 말할 때 늦게 나오지 않게) */
export function preloadVoices() {
  const graph = getSfxGraph();
  if (!graph) return;
  for (const byGender of Object.values(FILES)) for (const { url } of Object.values(byGender)) void load(graph.ctx, url);
}

interface Speaking {
  priority: number;
  stop: () => void;
}
const speaking = new Map<string, Speaking>();

/**
 * speaker(연결 ID 등)가 kind 를 말한다. volume 0~1 은 거리로 줄인 값. 낼 수 없으면(너무 멀다·꽉 찼다·더 중요한 말 중) 조용히 넘어간다.
 */
export function playVoice(speaker: string, kind: VoiceKind, gender: VoiceGender, volume = 1) {
  if (volume <= 0.02) return;
  const priority = PRIORITY[kind];
  const current = speaking.get(speaker);
  if (current && current.priority > priority) return;
  if (!current && speaking.size >= MAX_AT_ONCE) return;
  const graph = getSfxGraph();
  if (!graph) return;
  current?.stop();
  const { ctx, output } = graph;
  const file = FILES[kind][gender];
  let source: AudioBufferSourceNode | null = null;
  let cancelled = false;
  const entry: Speaking = {
    priority,
    stop: () => {
      cancelled = true;
      try {
        source?.stop();
      } catch {
        // 이미 끝났다
      }
    },
  };
  speaking.set(speaker, entry);
  const finish = () => {
    if (speaking.get(speaker) === entry) speaking.delete(speaker);
  };
  void load(ctx, file.url).then((buffer) => {
    // 불러오는 사이 끊겼으면(숨기기·더 중요한 말) 시작하지 않는다
    if (cancelled || !buffer) {
      finish();
      return;
    }
    source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = voiceGain(file.lufs) * volume;
    source.connect(gain).connect(output);
    source.onended = () => {
      finish();
      source?.disconnect();
      gain.disconnect();
    };
    source.start();
  });
}

/** 그 사람이 지금 하는 말(불러오는 중 포함)을 끊는다 — 숨기기 */
export function silenceSpeaker(speaker: string) {
  speaking.get(speaker)?.stop();
  speaking.delete(speaker);
}
