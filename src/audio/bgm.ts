import { settingsStore } from "@/settings/settings";

// 몇 분짜리 곡을 통째로 디코드하면 메모리가 커서 효과음(sound.ts)과 달리 <audio> 로 흘려 듣는다. 한 번에 한 곡만.
// 전환 영상 배경음악은 나주 페이지에서도 이어 틀어야 해서 naju01/src/전환/로딩영상.jsx 가 따로 튼다.
// 주소가 null 인 곡은 틀라고 해도 아무 일도 안 한다.
export const BGM_TRACKS: Record<"najuEnter", string | null> = {
  najuEnter: null,
};

export type BgmTrack = keyof typeof BGM_TRACKS;

export interface PlayBgmOptions {
  loop?: boolean;
  startAt?: number;
}

let current: { track: BgmTrack; audio: HTMLAudioElement } | null = null;
let fadeScale = 1;

function bgmVolume() {
  return Math.max(0, Math.min(1, settingsStore.get().bgmVolume * fadeScale));
}

settingsStore.subscribe(() => {
  if (current) current.audio.volume = bgmVolume();
});

/** 곡을 튼다. 같은 곡이 이미 나오면 그대로 둔다. */
export function playBgm(track: BgmTrack, { loop = true, startAt = 0 }: PlayBgmOptions = {}) {
  const src = BGM_TRACKS[track];
  if (!src) return false;
  if (current?.track === track) return true;
  stopBgm(0.6);
  const audio = new Audio(src);
  audio.loop = loop;
  audio.currentTime = startAt;
  fadeScale = 1;
  audio.volume = bgmVolume();
  audio.play().catch(() => {
    // 사용자 입력 전이면 브라우저가 막는다 — 다음 입력 때 다시 튼다.
    const retry = () => {
      audio.play().catch(() => {});
      window.removeEventListener("keydown", retry);
      window.removeEventListener("pointerdown", retry);
    };
    window.addEventListener("keydown", retry);
    window.addEventListener("pointerdown", retry);
  });
  current = { track, audio };
  return true;
}

/** 서서히 줄이며 끈다(초). */
export function stopBgm(seconds = 0.8) {
  const previous = current;
  if (!previous) return;
  current = null;
  const startTime = performance.now();
  const startVolume = previous.audio.volume;
  const step = () => {
    const t = Math.min(1, (performance.now() - startTime) / (seconds * 1000));
    previous.audio.volume = startVolume * (1 - t);
    if (t < 1) requestAnimationFrame(step);
    else {
      previous.audio.pause();
      previous.audio.src = "";
    }
  };
  if (seconds <= 0) {
    previous.audio.pause();
    previous.audio.src = "";
  } else requestAnimationFrame(step);
}
