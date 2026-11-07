// 로비 스피커 음악 — 미르 유튜브 재생목록(본인이 만든 곡만)을 각자 듣는다(방 동기화 없음). 검토 17회차.
// 유튜브 규정: 퍼간 플레이어는 늘 보여야 하고(200×200 이상, 가리지 않기), 닫거나 내린 채 계속 재생하면 안 된다.
// 그래서 플레이어는 하나만 만들어 큰 화면 ↔ 미니(화면 구석에 보이는 작은 플레이어)로 옮겨 다니고, 닫히거나
// 안 보이게 되는 순간(탭 숨김 · 컷신 · 다른 창 · 기차 · 나주) 멈추고 없앤다. 자동으로 다시 틀지 않는다.
//   https://developers.google.com/youtube/terms/required-minimum-functionality
//   https://developers.google.com/youtube/terms/developer-policies
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { createChangeSignal } from "@/lib/changeSignal";
import { settingsStore } from "@/settings/settings";

import { onVoiceStart, type VoiceKind } from "../voices";
import { loadYouTubeApi, PLAYER_STATE, type YouTubePlayer } from "./youtube";

/** 미르 재생목록 「왜곡」(NOIR GROOVE LAB 8곡, 11/7 교체). 첫 곡은 미르가 준 주소 그대로 */
const PLAYLIST_ID = "PLcZ1Rv4EdVXE";
const FIRST_VIDEO_ID = "s878k4Y6MIE";
export const PLAYLIST_URL = `https://www.youtube.com/watch?v=${FIRST_VIDEO_ID}&list=${PLAYLIST_ID}`;
/** 겨냥 등록 이름(스피커 ↔ 화면 안내문) */
export const SPEAKER_AIM_ID = "lobby:speaker";

/**
 * 처음 볼륨 = 설정 「배경음악」 × 이 비율(기본 0.6 → 10). 목소리는 −20.5 LUFS × 효과음 0.65 ≈ −24 LUFS 인데 유튜브 곡은
 * 대체로 −14 LUFS 라, 30 이면 목소리와 같은 크기로 쉬지 않고 깔려 「너무 크다」(11/7 미르). 10(약 −20dB)이면 목소리보다
 * 10dB 쯤 아래 — 배경음악은 대사보다 10~20dB 아래가 보통이다.
 */
const VOLUME_SHARE = 1 / 6;
/** 인사 · 대사가 날 때 잠깐 이만큼으로(주먹 · 맞기 · 점프는 줄이지 않는다) */
const DUCK_RATIO = 0.5;
const DUCK_KINDS: ReadonlySet<VoiceKind> = new Set(["greet", "joy", "move", "sorry", "thanks", "ok"]);
/**
 * 미니 플레이어 — 규정 하한(가로 · 세로 200 이상)의 정사각형. 그 바깥을 HUD 카드(테두리 1 + 여백 5)가 감싼다 —
 * MINI_CARD_WIDTH 는 카드 바깥 폭. 이보다 좁은 화면은 미니 없이 큰 화면 · 닫기만
 */
export const MINI_SIZE = { width: 200, height: 200 } as const;
export const MINI_CARD_PADDING = 5;
export const MINI_CARD_WIDTH = MINI_SIZE.width + (MINI_CARD_PADDING + 1) * 2;
export const canMini = () => window.innerWidth >= 720 && window.innerHeight >= 520;

export type MusicMode = "closed" | "big" | "mini";
export interface MusicState {
  mode: MusicMode;
  /** 유튜브가 실제로 재생 중(스피커 연출) */
  playing: boolean;
  /** 자동 재생이 막혀 플레이어의 ▶ 를 직접 눌러야 한다 */
  blocked: boolean;
  error: string | null;
  /** 큰 화면을 닫은 뒤 마우스 잠금을 못 되돌렸다 — [T] 안내 */
  relockFailed: boolean;
  /** 지금 곡 제목(모르면 null — 화면이 「본부실 스피커」로 둔다) */
  title: string | null;
}

const signal = createChangeSignal();
let state: MusicState = {
  mode: "closed",
  playing: false,
  blocked: false,
  error: null,
  relockFailed: false,
  title: null,
};
function set(patch: Partial<MusicState>) {
  state = { ...state, ...patch };
  signal.notify();
}
export const musicStore = { get: () => state, subscribe: signal.subscribe };
export const useMusic = () => useSyncExternalStore(musicStore.subscribe, musicStore.get, musicStore.get);

// ── 플레이어 ──
let host: HTMLElement | null = null;
let player: YouTubePlayer | null = null;
let ready = false;
/** 만들다 만 플레이어를 버리는 표 — 닫은 뒤 늦게 도착한 콜백을 무시한다 */
let generation = 0;

const clampVolume = (value: number) => Math.round(Math.min(100, Math.max(0, value)));
const startVolume = () => clampVolume((settingsStore.get().bgmVolume ?? 0.6) * 100 * VOLUME_SHARE);

function errorText(code: number) {
  if (code === 100) return "영상이 없거나 비공개예요";
  if (code === 101 || code === 150) return "이 영상은 퍼가기가 막혀 있어요";
  if (code === 153) return "출처 정보가 없어 유튜브가 재생을 막았어요";
  if (code === 2) return "재생목록 주소가 잘못됐어요";
  if (code === 5) return "이 브라우저에서 재생할 수 없어요";
  return `재생하지 못했어요(오류 ${code})`;
}

/**
 * 지금 곡 제목. getVideoData 는 공식 문서에 없는 함수라 있는지 보고, 실패하면 null(Codex 20).
 * 곡 이름 뒤 「[Lyrics/한글자막] …」 꼬리표만 떼고, 나머지 긴 제목은 화면이 말줄임한다
 */
function readTitle(target: YouTubePlayer): string | null {
  try {
    const raw = target.getVideoData?.()?.title?.trim();
    if (!raw) return null;
    return raw.split("[")[0].trim() || raw;
  } catch {
    return null;
  }
}
function updateTitle(target: YouTubePlayer) {
  const title = readTitle(target);
  if (title && title !== state.title) set({ title });
}

async function createPlayer(element: HTMLElement) {
  const mine = ++generation;
  let api;
  try {
    api = await loadYouTubeApi();
  } catch {
    if (mine === generation)
      set({ error: "유튜브를 불러오지 못했어요 — 네트워크나 학교 · 기관 망이 막았을 수 있어요" });
    return;
  }
  if (mine !== generation || state.mode === "closed" || host !== element) return;
  // 유튜브가 넘긴 요소를 iframe 으로 바꿔 끼운다 — React 가 그린 상자 안에 따로 만든 칸을 준다
  const target = document.createElement("div");
  element.replaceChildren(target);
  player = new api.Player(target, {
    host: "https://www.youtube-nocookie.com",
    videoId: FIRST_VIDEO_ID,
    width: "100%",
    height: "100%",
    playerVars: { listType: "playlist", list: PLAYLIST_ID, playsinline: 1, rel: 0, origin: window.location.origin },
    events: {
      onReady: (event) => {
        if (mine !== generation) return;
        ready = true;
        updateTitle(event.target);
        event.target.setVolume(startVolume());
        event.target.playVideo();
      },
      onStateChange: (event) => {
        if (mine !== generation) return;
        updateTitle(event.target);
        const playing = event.data === PLAYER_STATE.playing;
        if (playing !== state.playing || (playing && state.blocked))
          set({ playing, blocked: playing ? false : state.blocked });
        if (!playing) endDuck();
      },
      onError: (event) => {
        if (mine === generation) set({ error: errorText(event.data), playing: false });
      },
      onAutoplayBlocked: () => {
        if (mine === generation) set({ blocked: true });
      },
    },
  });
}

function destroyPlayer() {
  generation += 1;
  ready = false;
  endDuck(true);
  const old = player;
  player = null;
  try {
    old?.stopVideo();
    old?.destroy();
  } catch {
    // 이미 사라진 iframe
  }
  host?.replaceChildren();
}

/** 화면이 플레이어 자리(빈 상자)를 붙이거나 뗀다. ref 로 그대로 넘긴다 */
export function attachHost(element: HTMLElement | null) {
  if (element === host) return;
  if (!element) {
    // 플레이어 자리가 화면에서 사라졌다 — 보이지 않는 재생은 안 된다. 한 박자 기다려 본다: React 개발 모드(StrictMode)는
    // ref 를 붙였다 떼었다 다시 붙여 보는데, 그 사이에 닫으면 열자마자 닫힌다
    host = null;
    setTimeout(() => {
      if (host) return;
      if (state.mode !== "closed") closeMusic("system");
      else destroyPlayer();
    }, 0);
    return;
  }
  host = element;
  if (state.mode !== "closed" && !player) void createPlayer(element);
}

// ── 마우스 잠금 ── 큰 화면을 열 때 풀고, 직접 닫거나 작게 했을 때만 원래 요소로 되돌린다(채팅창과 같은 방식)
let lockTarget: Element | null = null;
let relockNoticeTimer: ReturnType<typeof setTimeout> | undefined;

function releaseLock() {
  if (!document.pointerLockElement) return;
  lockTarget = document.pointerLockElement;
  document.exitPointerLock();
}

function restoreLock() {
  const target = lockTarget;
  lockTarget = null;
  if (!target?.isConnected) return;
  const fail = () => {
    set({ relockFailed: true });
    clearTimeout(relockNoticeTimer);
    relockNoticeTimer = setTimeout(() => set({ relockFailed: false }), 3500);
  };
  try {
    void Promise.resolve(target.requestPointerLock()).catch(fail);
  } catch {
    fail();
  }
}

// ── 이동 키 풀기 ── 큰 화면을 열 때 누르고 있던 이동 키를 뗀 것으로 알린다. 새로 누르는 키는 화면이 막지만, 이미 눌린
// W 는 이동 쪽에 「눌림」으로 남아 창 뒤에서 계속 걸었다(Codex 리뷰). 이동은 keyup 으로만 풀리므로 그것을 보낸다.
const MOVEMENT_CODES = [
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
];
function releaseMovementKeys() {
  for (const code of MOVEMENT_CODES) window.dispatchEvent(new KeyboardEvent("keyup", { code }));
}

// ── 자동 재생 ── 이번 방문에 본부실에 처음 들어오면 한 번, 미니로 튼다(미르 11/7: 들어오면 기본으로 재생).
// 미니는 화면에 다 보이는 플레이어라 규정의 「절반 이상 보일 때만 자동 재생」을 지킨다. 「정지하고 닫기」를 직접 누르면
// 기억해 다음 방문부터 안 틀고, 라디오를 다시 켜면 그 기억을 지운다. 좁은 화면(미니 불가)은 자동으로 안 튼다.
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
  if (state.mode !== "closed" || readAutoOff() || !canMini()) return;
  set({ mode: "mini", error: null, blocked: false, relockFailed: false });
  if (host && !player) void createPlayer(host);
}

// ── 여닫기 ──
/** 스피커 [E] · 클릭 — 닫혀 있으면 큰 화면으로 틀고, 미니면 크게. 길게 눌러 여러 번 와도 한 번만 */
export function openMusic() {
  if (state.mode === "big") return;
  writeAutoOff(false);
  releaseLock();
  releaseMovementKeys();
  const fresh = state.mode === "closed";
  set({ mode: "big", relockFailed: false, ...(fresh ? { error: null, blocked: false } : {}) });
  if (host && !player) void createPlayer(host);
}

/** 큰 화면 → 미니(계속 듣기). 미니를 둘 수 없는 좁은 화면이면 멈추고 닫는다 */
export function minimizeMusic() {
  if (state.mode !== "big") return;
  if (!canMini()) {
    closeMusic("user");
    return;
  }
  set({ mode: "mini" });
  restoreLock();
}

export function expandMusic() {
  if (state.mode !== "mini") return;
  releaseLock();
  releaseMovementKeys();
  set({ mode: "big" });
}

/** 멈추고 닫는다. user = 사람이 눌렀다(잠금을 되돌린다), system = 컷신 · 다른 창 · 탭 숨김 등(되돌리지 않는다) */
export function closeMusic(reason: "user" | "system") {
  if (state.mode === "closed") return;
  const wasBig = state.mode === "big";
  if (reason === "user") writeAutoOff(true);
  destroyPlayer();
  set({ mode: "closed", playing: false, blocked: false, error: null, title: null });
  if (reason === "user" && wasBig) restoreLock();
  else lockTarget = null;
}

// ── 소리 ──
let lastBgm = settingsStore.get().bgmVolume;
settingsStore.subscribe(() => {
  const bgm = settingsStore.get().bgmVolume;
  if (bgm === lastBgm) return;
  lastBgm = bgm;
  // 설정을 바꿨을 때만 따른다 — 그 밖엔 플레이어에서 직접 바꾼 볼륨이 이긴다
  if (player && ready) {
    endDuck(true);
    player.setVolume(startVolume());
  }
});

let duck: { base: number; until: number; timer: ReturnType<typeof setTimeout> } | null = null;
function endDuck(skipRestore = false) {
  if (!duck) return;
  clearTimeout(duck.timer);
  const { base } = duck;
  duck = null;
  if (!skipRestore && player && ready) player.setVolume(base);
}
onVoiceStart((kind, seconds, volume) => {
  if (!DUCK_KINDS.has(kind) || volume < 0.25 || !player || !ready || !state.playing || player.isMuted()) return;
  const until = performance.now() + seconds * 1000 + 200;
  if (duck) {
    // 겹친 말은 더 줄이지 않고, 가장 늦게 끝나는 말까지 줄인 채로 둔다(짧은 말이 긴 말을 앞당겨 풀지 않게 — Codex 리뷰)
    if (until <= duck.until) return;
    duck.until = until;
    clearTimeout(duck.timer);
    duck.timer = setTimeout(() => endDuck(), until - performance.now());
    return;
  }
  const base = player.getVolume();
  player.setVolume(clampVolume(base * DUCK_RATIO));
  duck = { base, until, timer: setTimeout(() => endDuck(), until - performance.now()) };
});

if (import.meta.env.DEV)
  exposeDevHook("lobbyMusic", {
    state: () => state,
    volume: () => (player && ready ? player.getVolume() : null),
    /** 검사용 — 다음 곡으로 넘긴다 */
    next: () => player?.nextVideo(),
    ducking: () => duck !== null,
  });

// ── 안 보이게 되면 멈춤 ──
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) closeMusic("system");
  });
  window.addEventListener("resize", () => {
    if (state.mode === "mini" && !canMini()) closeMusic("system");
  });
}
