// 로비 스피커 음악 — 미르 곡(public/lobby-music, 8곡)을 각자 듣는다(방 동기화 없음). 검토 17 · 20 · 21회차.
// 켤 때마다 곡 순서를 무작위로 섞어 차례로 틀고, 다 돌면 다시 섞는다(미르 11/7 「매번 랜덤 순서로」). 화면은 「제목 · 가수」만
// 띄운다(MusicPanel 알약). 처음엔 유튜브 재생목록을 퍼 왔는데, 규정상 200×200 플레이어를 늘 보여야 해서 화면이 컸다 →
// 미르가 음원을 직접 줬다(21회차).
// 소리 길: <audio> 하나 → 게인(설정 「배경음악」 × 비율, 대사 중 덕킹) → 효과음과 같은 오디오 컨텍스트.
//   · 요소와 연결은 한 번만 만들고 곡마다 src 만 바꾼다(한 요소는 한 번만 이을 수 있다). 멈출 때도 음악 요소만 멈추고
//     컨텍스트는 그대로 둔다(효과음이 같이 쓴다).
//   · 아이폰은 audio.volume 이 안 먹어 게인으로 조절한다. 컨텍스트가 없는 브라우저만 audio.volume 으로 대신한다.
import { useSyncExternalStore } from "react";

import { getSfxGraph } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";
import { settingsStore } from "@/settings/settings";

import { onVoiceStart, type VoiceKind } from "../voices";

export interface Track {
  file: string;
  title: string;
  artist: string;
}

/**
 * 곡 표. 제목 · 가수는 미르 유튜브 채널(NOIR GROOVE LAB)에 올린 이름을 따른다 — 파일 태그의 가수는 계정 이름
 * (goldmireu)이고, 「미뤄둔 안부」는 안쪽 제목 태그가 다른 곡 이름이라 쓰지 않는다. 파일은 128kbps · 44.1kHz mp3 로
 * 다시 굽고 −14 LUFS 로 맞춰(무작위로 섞어도 곡마다 크기가 안 튀게) 태그를 지웠다(검토 21회차).
 */
export const TRACKS: readonly Track[] = [
  { file: "street.mp3", title: "Street", artist: "Goldie Groove" },
  { file: "the-weight.mp3", title: "The Weight", artist: "Goldie Groove" },
  { file: "echo.mp3", title: "Echo", artist: "Goldie Groove" },
  { file: "rise.mp3", title: "Rise", artist: "Goldie Groove" },
  { file: "neoege-dakgireul.mp3", title: "너에게 닿기를", artist: "골디" },
  { file: "may-it-reach-you.mp3", title: "May it reach you", artist: "골디" },
  { file: "neujeun-jakbyeol.mp3", title: "늦은 작별", artist: "골디" },
  { file: "mirwodun-anbu.mp3", title: "미뤄둔 안부", artist: "골디" },
];
/** Vite 가 public 을 루트(/)로 서빙한다(효과음 /sfx 와 같은 방식) */
const MUSIC_DIR = "/lobby-music/";

/** 겨냥 등록 이름(스피커 ↔ 화면 안내문) */
export const SPEAKER_AIM_ID = "lobby:speaker";

/**
 * 볼륨 = 설정 「배경음악」 × 이 비율(기본 0.6 → 0.1, 약 −20dB). 곡은 −14 LUFS, 목소리는 −20.5 LUFS × 효과음 0.65 ≈ −24 LUFS
 * 라 그대로 틀면 목소리와 같은 크기로 쉬지 않고 깔린다(11/7 미르 「너무 크다」). 0.1 이면 목소리보다 10dB 쯤 아래 🟡
 */
const VOLUME_SHARE = 1 / 6;
/** 인사 · 대사가 날 때 잠깐 이만큼으로(주먹 · 맞기 · 점프는 줄이지 않는다) */
const DUCK_RATIO = 0.5;
const DUCK_KINDS: ReadonlySet<VoiceKind> = new Set(["greet", "joy", "move", "sorry", "thanks", "ok"]);
/** 볼륨이 바뀔 때 미끄러지는 시간(초) — 덕킹이 뚝 끊기지 않게 */
const VOLUME_GLIDE = 0.12;

export interface MusicState {
  /** 켜져 있다(사람이나 자동 재생이 켰고 아직 안 껐다). 잠깐 멈춤 중이어도 참 */
  on: boolean;
  /** 실제로 소리가 나는 중(스피커 연출) */
  playing: boolean;
  /** 브라우저가 자동 재생을 막아 사용자 입력을 기다린다 — 다음 클릭 · 키에 다시 튼다 */
  blocked: boolean;
  error: string | null;
  track: Track | null;
}

const signal = createChangeSignal();
let state: MusicState = { on: false, playing: false, blocked: false, error: null, track: null };
function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  signal.notify();
}
export const musicStore = { get: () => state, subscribe: signal.subscribe };
export const useMusic = () => useSyncExternalStore(musicStore.subscribe, musicStore.get, musicStore.get);

// ── 순서 ── 켤 때마다 새로 섞는다. 다 돌면 다시 섞되 방금 곡이 바로 또 나오지 않게
let order: Track[] = [];
let index = 0;
let lastTrack: Track | null = null;

function shuffled(avoidFirst: Track | null): Track[] {
  const list = [...TRACKS];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (avoidFirst && list.length > 1 && list[0] === avoidFirst) {
    const j = 1 + Math.floor(Math.random() * (list.length - 1));
    [list[0], list[j]] = [list[j], list[0]];
  }
  return list;
}

// ── 소리 길 ──
let audio: HTMLAudioElement | null = null;
let gain: GainNode | null = null;
/**
 * 마지막으로 재생에 성공한 뒤 실패한 곡들 — 서로 다른 곡이 전부 실패하면 멈추고 알린다. 회차를 넘기며 다시 섞으면 같은 곡을
 * 또 만날 수 있어 시도 횟수가 아니라 곡으로 센다(Codex 21 리뷰). 자동 재생 막힘은 세지 않는다
 */
const failed = new Set<Track>();
let ducked = false;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const baseVolume = () => clamp01((settingsStore.get().bgmVolume ?? 0.6) * VOLUME_SHARE);
const targetVolume = () => baseVolume() * (ducked ? DUCK_RATIO : 1);

function applyVolume(glide = VOLUME_GLIDE) {
  const volume = targetVolume();
  if (gain) {
    const now = gain.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    if (glide > 0) gain.gain.setTargetAtTime(volume, now, glide / 3);
    else gain.gain.setValueAtTime(volume, now);
  } else if (audio) audio.volume = volume;
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const element = new Audio();
  element.preload = "auto";
  audio = element;
  const graph = getSfxGraph();
  if (graph) {
    try {
      const source = graph.ctx.createMediaElementSource(element);
      gain = graph.ctx.createGain();
      source.connect(gain).connect(graph.ctx.destination);
    } catch {
      gain = null;
    }
  }
  applyVolume(0);
  element.addEventListener("playing", () => {
    failed.clear();
    if (!state.playing || state.error) set({ playing: true, error: null });
  });
  element.addEventListener("pause", () => {
    if (state.playing) set({ playing: false });
    endDuck();
  });
  element.addEventListener("ended", () => {
    if (state.on) advance();
  });
  element.addEventListener("error", () => {
    // 끈 뒤 src 를 비울 때 나는 오류는 무시한다
    if (!state.on || !element.getAttribute("src")) return;
    if (state.track) failed.add(state.track);
    if (failed.size >= TRACKS.length) {
      element.pause();
      set({ playing: false, error: "음악을 불러오지 못했어요" });
      return;
    }
    advance();
  });
  return element;
}

function load(track: Track) {
  const element = ensureAudio();
  element.src = `${MUSIC_DIR}${track.file}`;
  lastTrack = track;
  set({ track });
}

function advance() {
  index += 1;
  if (index >= order.length) {
    order = shuffled(lastTrack);
    index = 0;
  }
  load(order[index]);
  void tryPlay();
}

// ── 잠깐 멈춤 ── 이유가 하나라도 남아 있으면 멈춰 있고, 다 풀리고 켜져 있을 때만 이어 튼다(Codex 21)
export type PauseReason = "tab" | "cutscene" | "curtain";
const pauseReasons = new Set<PauseReason>();

export function setMusicPaused(reason: PauseReason, paused: boolean) {
  if (paused === pauseReasons.has(reason)) return;
  if (paused) pauseReasons.add(reason);
  else pauseReasons.delete(reason);
  if (pauseReasons.size > 0) audio?.pause();
  else if (state.on) void tryPlay();
}

// ── 재생 ── 사용자 입력 안에서 부르면 컨텍스트 깨우기와 play() 를 같은 순간에 시도한다(둘 다 입력이 있어야 풀린다)
let playTicket = 0;
async function tryPlay() {
  if (!state.on || pauseReasons.size > 0 || state.error) return;
  const element = ensureAudio();
  const ticket = ++playTicket;
  const context = gain?.context as AudioContext | undefined;
  const resumed = context && context.state !== "running" ? context.resume().catch(() => {}) : Promise.resolve();
  try {
    await element.play();
  } catch (error) {
    if (ticket !== playTicket) return;
    if ((error as DOMException)?.name === "NotAllowedError") waitForGesture();
    // AbortError(곡을 바꾸거나 멈춰서 끊김) · 파일 오류(error 이벤트가 따로 처리)는 여기서 넘긴다
    return;
  }
  // 요소는 돌아도 컨텍스트가 잠들어 있으면 소리가 안 난다 — 잠깐 기다려 보고 그래도 안 깨면 멈추고 입력을 기다린다
  await Promise.race([resumed, new Promise((resolve) => setTimeout(resolve, 300))]);
  if (ticket !== playTicket || !state.on) return;
  if (context && context.state !== "running") {
    element.pause();
    waitForGesture();
    return;
  }
  if (state.blocked) set({ blocked: false });
}

let gestureRetry: (() => void) | null = null;
function cancelGestureWait() {
  if (!gestureRetry) return;
  window.removeEventListener("pointerdown", gestureRetry, true);
  window.removeEventListener("keydown", gestureRetry, true);
  gestureRetry = null;
}
function waitForGesture() {
  if (!state.blocked) set({ blocked: true });
  if (gestureRetry) return;
  gestureRetry = () => {
    cancelGestureWait();
    void tryPlay();
  };
  window.addEventListener("pointerdown", gestureRetry, true);
  window.addEventListener("keydown", gestureRetry, true);
}

// ── 자동 재생 ── 이번 방문에 본부실에 처음 들어오면 한 번 튼다(미르 11/7: 들어오면 기본으로 재생).
// 「끄기」를 직접 누르면 기억해 다음 방문부터 안 틀고, 다시 켜면 그 기억을 지운다.
const AUTO_OFF_KEY = "waegok.lobbyMusic.autoOff";
function readAutoOff() {
  try {
    return window.localStorage.getItem(AUTO_OFF_KEY) === "1";
  } catch {
    return false;
  }
}
function writeAutoOff(off: boolean) {
  try {
    if (off) window.localStorage.setItem(AUTO_OFF_KEY, "1");
    else window.localStorage.removeItem(AUTO_OFF_KEY);
  } catch {
    // 저장소를 못 쓰는 창(비공개 등) — 이번 방문에만 따른다
  }
}
let autoTried = false;

/** 본부실에 들어선 첫 순간(막힘 없을 때) 부른다. 이번 방문에 한 번만 */
export function autoStartMusic() {
  if (autoTried) return;
  autoTried = true;
  if (state.on || readAutoOff()) return;
  startMusic();
}

// ── 켜고 끄기 ──
/** 켠다 — 매번 순서를 새로 섞는다 */
export function startMusic() {
  if (state.on) return;
  failed.clear();
  order = shuffled(lastTrack);
  index = 0;
  set({ on: true, error: null, blocked: false });
  load(order[0]);
  void tryPlay();
}

/** 끈다. user = 사람이 눌렀다(다음 방문부터 자동 재생 안 함), system = 본부실을 떠남 등 */
export function stopMusic(reason: "user" | "system") {
  if (!state.on) return;
  if (reason === "user") writeAutoOff(true);
  playTicket += 1;
  set({ on: false, playing: false, blocked: false, error: null, track: null });
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

/** 스피커 [E] · 클릭 — 꺼져 있으면 켜고, 켜져 있으면 끈다. 막혀서 기다리는 중이면 다시 틀어 본다 */
export function toggleMusic() {
  if (!state.on) {
    writeAutoOff(false);
    startMusic();
  } else if (state.blocked) void tryPlay();
  else stopMusic("user");
}

/** 다음 곡(실패해서 멈췄으면 다시 시도) */
export function nextTrack() {
  if (!state.on) return;
  if (state.error) {
    failed.clear();
    set({ error: null });
  }
  advance();
}

// ── 소리 크기 ──
const stopFollowingSettings = settingsStore.subscribe(() => applyVolume());

let duckTimer: ReturnType<typeof setTimeout> | undefined;
let duckUntil = 0;
function endDuck() {
  clearTimeout(duckTimer);
  if (!ducked) return;
  ducked = false;
  applyVolume();
}
const stopFollowingVoices = onVoiceStart((kind, seconds, volume) => {
  if (!DUCK_KINDS.has(kind) || volume < 0.25 || !state.playing) return;
  const until = performance.now() + seconds * 1000 + 200;
  // 겹친 말은 더 줄이지 않고, 가장 늦게 끝나는 말까지 줄인 채로 둔다(짧은 말이 긴 말을 앞당겨 풀지 않게)
  if (ducked && until <= duckUntil) return;
  duckUntil = until;
  clearTimeout(duckTimer);
  duckTimer = setTimeout(endDuck, until - performance.now());
  if (!ducked) {
    ducked = true;
    applyVolume();
  }
});

if (import.meta.env.DEV)
  exposeDevHook("lobbyMusic", {
    state: () => state,
    /** 지금 나가는 소리 크기(게인이나 audio.volume) */
    volume: () => (gain ? gain.gain.value : (audio?.volume ?? null)),
    ducking: () => ducked,
    order: () => order.map((track) => track.title),
    index: () => index,
    paused: () => [...pauseReasons],
    next: nextTrack,
    toggle: toggleMusic,
    /** 검사용 — 곡 끝 근처로 건너뛴다 */
    seekNearEnd: (seconds = 1.5) => {
      if (audio && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, audio.duration - seconds);
    },
    position: () => (audio ? { time: audio.currentTime, duration: audio.duration, paused: audio.paused } : null),
    contextState: () => gain?.context.state ?? null,
  });

// ── 탭을 숨기면 잠깐 멈춤 ──
const onVisibilityChange = () => setMusicPaused("tab", document.hidden);
if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);

// ── 개발 서버 고쳐 끼우기(HMR) ── 이 파일이나 가져오는 파일(소리 · 설정 · 목소리)을 고치면 이 모듈이 새로 실행된다.
// <audio> 는 화면(DOM) 밖에 있어 React 가 치워 주지 않으니, 옛 모듈의 곡이 멈추지 않은 채 새 모듈이 또 틀어 두 곡이 겹쳤다
// (11/8 미르 「음악이 두 개 동시에」 — 고칠 때마다 하나씩 늘었다). Vite 는 고친 파일이 아니라 그걸 쓰는 화면 파일을 갈아
// 끼워 이 모듈의 hot.dispose 가 불리지 않는다 — 그래서 전역 자리에 지금 플레이어를 걸어 두고, 새 모듈이 뜰 때 옛 것을 멈추고
// 듣기를 다 뗀다. 켜져 있었으면 새 모듈이 이어 켜고, 자동 재생은 이미 한 것으로 넘긴다. 개발 서버에서만 돈다.
interface HotSlot {
  autoTried: () => boolean;
  wasOn: () => boolean;
  dispose: () => void;
}
const HOT_SLOT = "__waegokLobbyMusic";
if (import.meta.hot) {
  const slots = globalThis as typeof globalThis & { [HOT_SLOT]?: HotSlot };
  const previous = slots[HOT_SLOT];
  const resume = previous?.wasOn() ?? false;
  if (previous) {
    if (previous.autoTried()) autoTried = true;
    previous.dispose();
  }
  slots[HOT_SLOT] = {
    autoTried: () => autoTried,
    wasOn: () => state.on,
    dispose: () => {
      playTicket += 1;
      clearTimeout(duckTimer);
      cancelGestureWait();
      stopFollowingSettings();
      stopFollowingVoices();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      gain?.disconnect();
    },
  };
  if (resume) startMusic();
}
