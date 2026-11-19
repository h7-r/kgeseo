/**
 * 화면이 넘어가는 사이(렌더링·모델 읽기)를 반복 영상 + 흐르는 안내 문장으로 가리는 막의 상태·명령·음악.
 *   entry    웹사이트 → 캐릭터 생성. 웹사이트가 틀던 오프닝 시네마틱을 그 초부터 잇는다(?transition=2.61)
 *   resume   웹사이트 → 다시 접속(저장 단계가 있다). 오프닝은 처음 한 번만 — 입장 영상만 짧게(replaceOpeningWithResume)
 *   tutorial 캐릭터 생성 → 튜토리얼. 경주 → 여수 반복
 *   naju     기차 내부 → 나주 맵. 나주 진입 영상을 한 번 튼 뒤 목포 → 순천 반복
 * 렌더 시간은 기계마다 달라(3초~20초) 길이를 정하지 않고 준비될 때까지 돈다.
 * 본편과 나주 페이지가 둘 다 이 막을 띄운다 — naju01 이 본편을 가져오면 고리가 생기므로 naju01 쪽에 둔다.
 */
import { useSyncExternalStore } from "react";

import { trackMedia } from "@/engine/input/gamePause";
import { isMediaHeld, subscribeLandscape } from "@/engine/input/landscape";

import { TRANSITION_VIDEO_DIR } from "./readinessCheck";

export type LoadingVideoKind = "entry" | "resume" | "tutorial" | "naju";

export interface LoadingVideoOptions {
  /** true 면 이 페이지에서 준비가 끝나도 걷지 않는다(곧 페이지를 옮기고, 다음 페이지가 걷는다) */
  keepOpen?: boolean;
}

// 배경음악
// 입장은 오프닝 영상이 제 소리를 갖고 있어 곡을 따로 틀지 않는다.
// 보정은 곡 크기(EBU R128)를 맞춘 값 — Final Chord −16.3 LUFS, Drone −14.4 LUFS → Drone 을 1.9dB 낮춘다.
const MUSIC: Partial<Record<LoadingVideoKind, { url: string; gain: number }>> = {
  resume: { url: "/bgm/final-chord.mp3", gain: 1 },
  tutorial: { url: "/bgm/final-chord.mp3", gain: 1 },
  naju: { url: "/bgm/atmospheric-drone.mp3", gain: 0.8 },
};

// naju01 은 본편 settings 를 가져오면 안 되므로 같은 localStorage 를 직접 읽는다(열쇠·기본값을 본편과 같게).
// 본편이 한 번도 안 떴으면 한글 필드의 이전 열쇠에만 값이 있다 — 읽기만 하고 옮기지 않는다.
const SETTINGS_KEY = "kgeseo.settings.v1";
const LEGACY_SETTINGS_KEY = "kgeseo.설정.v1";
const DEFAULT_BGM_VOLUME = 0.6;

/** 설정의 「배경음악」 크기(0~1) */
export function getBgmVolume(): number {
  try {
    const current = localStorage.getItem(SETTINGS_KEY);
    const value: unknown = current
      ? (JSON.parse(current) as { bgmVolume?: unknown }).bgmVolume
      : (JSON.parse(localStorage.getItem(LEGACY_SETTINGS_KEY) || "{}") as { 배경음악?: unknown }).배경음악;
    return typeof value === "number" ? Math.max(0, Math.min(1, value)) : DEFAULT_BGM_VOLUME;
  } catch {
    return DEFAULT_BGM_VOLUME;
  }
}

let currentMusic: { kind: LoadingVideoKind; audio: HTMLAudioElement } | null = null;
/** 줄이며 끄는 중인 곡 — 손을 떠났어도 잡아 둠(세로 · 첫 탭 전)이면 같이 멈춘다(코덱스 13b회차) */
const fadingMusic = new Set<HTMLAudioElement>();
/** 퍼즐이 귀를 기울일 때 곡을 줄이는 배율(0~1) */
let musicDuck = 1;
let duckFrame = 0;

export function playMusic(kind: LoadingVideoKind, seconds = 0) {
  if (currentMusic?.kind === kind) return;
  stopMusic(0.6);
  const track = MUSIC[kind];
  if (!track) return;
  // #t= 로 시작 초를 주소에 실으면 그 지점부터 받는다(다 받고 옮기는 것보다 빨리 소리가 난다)
  const audio = new Audio(seconds > 0 ? `${track.url}#t=${seconds.toFixed(2)}` : track.url);
  audio.preload = "auto";
  audio.loop = true;
  // 문서에 붙지 않은 소리라 「전부 멈춤」이 찾을 수 있게 등록한다
  trackMedia(audio);
  audio.volume = getBgmVolume() * track.gain * musicDuck;
  currentMusic = { kind, audio };
  // 휴대폰에서 세로이거나 첫 탭 전이면 잡아 둔다 — 풀리는 순간(첫 탭의 몸짓 안) 아래 구독이 튼다
  if (isMediaHeld()) return;
  audio.play().catch(() => {
    // 새 페이지라 아직 입력이 없으면 브라우저가 막는다 — 첫 키·클릭에 다시 튼다
    // 터치의 pointerdown 은 사용자 몸짓으로 쳐 주지 않아(WebKit) 손을 뗄 때 나는 click 도 듣는다. 성공할 때까지 남겨 둔다
    const retry = () => {
      if (currentMusic?.audio !== audio) return stop();
      if (isMediaHeld()) return; // 잡혀 있으면 풀릴 때 구독이 튼다
      audio.play().then(stop, () => {});
    };
    const stop = () => {
      window.removeEventListener("keydown", retry);
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("click", retry);
    };
    window.addEventListener("keydown", retry);
    window.addEventListener("pointerdown", retry);
    window.addEventListener("click", retry);
  });
}

// 잡아 둠이 바뀌면 같은 곡을 멈추거나 잇는다 — stopMusic 은 곡을 놓아 버리므로 쓰지 않는다(코덱스 13회차)
let wasMusicHeld = isMediaHeld();
subscribeLandscape(() => {
  const held = isMediaHeld();
  if (held === wasMusicHeld) return;
  wasMusicHeld = held;
  // 줄이며 끄던 곡은 멈추기만 한다(되살리지 않는다 — 어차피 끝에 놓는다)
  if (held) for (const fading of fadingMusic) fading.pause();
  const audio = currentMusic?.audio;
  if (!audio) return;
  if (held) audio.pause();
  else audio.play().catch(() => {});
});

/** 설정에서 「배경음악」을 바꾸면 틀고 있는 곡에도 바로 먹인다. 줄이며 끄는 중인 곡은 이미 손을 떠났다. */
export function applyMusicVolume() {
  if (!currentMusic) return;
  currentMusic.audio.volume = getBgmVolume() * (MUSIC[currentMusic.kind]?.gain ?? 1) * musicDuck;
}

/** 곡을 배율까지 0.8초에 걸쳐 줄이거나 되살린다 */
export function setMusicDuck(level: number) {
  const from = musicDuck;
  const startedAt = performance.now();
  cancelAnimationFrame(duckFrame);
  const step = () => {
    const t = Math.min(1, (performance.now() - startedAt) / 800);
    musicDuck = from + (level - from) * t;
    applyMusicVolume();
    if (t < 1) duckFrame = requestAnimationFrame(step);
  };
  step();
}

/** 서서히 줄이며 끈다(초). 막이 사라진 뒤에도 끝까지 줄어들도록 모듈에 둔다. */
export function stopMusic(seconds = 1.2) {
  const previous = currentMusic;
  if (!previous) return;
  currentMusic = null;
  const startedAt = performance.now();
  const initialVolume = previous.audio.volume;
  fadingMusic.add(previous.audio);
  const halt = () => {
    fadingMusic.delete(previous.audio);
    previous.audio.pause();
    previous.audio.src = "";
  };
  if (seconds <= 0) return halt();
  const step = () => {
    const t = Math.min(1, (performance.now() - startedAt) / (seconds * 1000));
    previous.audio.volume = initialVolume * (1 - t);
    if (t < 1) requestAnimationFrame(step);
    else halt();
  };
  requestAnimationFrame(step);
}

export function getMusicTime(): number {
  return currentMusic?.audio.currentTime || 0;
}

// 영상
// 지역 영상 넷은 웹사이트 카드에 쓴 2배속 영상에서 소리만 뺀 것(854×480).
// 오프닝만 114초 · 1080p · 소리 있음(크기 = 설정 「배경음악」). 깃허브 파일 한도 때문에 웹용으로 줄인 것이다.
type ClipId = "opening" | "entry" | "gyeongju" | "yeosu" | "mokpo" | "suncheon" | "naju";

interface Clip {
  url: string;
  poster: string;
  label: string;
  hasSound?: boolean;
}

const clipUrl = (file: string) => TRANSITION_VIDEO_DIR + file;

export const CLIPS: Record<ClipId, Clip> = {
  opening: {
    url: clipUrl("opening-cinematic.mp4"),
    poster: clipUrl("opening-cinematic-poster.jpg"),
    label: "OPENING",
    hasSound: true,
  },
  entry: { url: clipUrl("game-enter.mp4"), poster: clipUrl("game-enter-poster.webp"), label: "합동수사본부" },
  gyeongju: {
    url: clipUrl("load-gyeongju.mp4"),
    poster: clipUrl("load-gyeongju-poster.webp"),
    label: "경주 · 신라의 비밀",
  },
  yeosu: { url: clipUrl("load-yeosu.mp4"), poster: clipUrl("load-yeosu-poster.webp"), label: "여수 · 거북선의 비밀" },
  mokpo: { url: clipUrl("load-mokpo.mp4"), poster: clipUrl("load-mokpo-poster.webp"), label: "목포 · 갓바위의 전설" },
  suncheon: {
    url: clipUrl("load-suncheon.mp4"),
    poster: clipUrl("load-suncheon-poster.webp"),
    label: "순천 · 순천만의 비밀",
  },
  naju: {
    url: clipUrl("naju-enter.mp4"),
    poster: clipUrl("naju-enter-poster.webp"),
    label: "NAJU-01 · 영산포 앙암바위",
  },
};

export function isClipId(value: string | undefined): value is ClipId {
  return value !== undefined && value in CLIPS;
}

// 안내 문장
// 세계관 문장은 「왜곡 세계관 설정서 v0.3」 에 적힌 것만. 조작 문장은 본편 튜토리얼 단계표와 같은 키다.
const CONTROL_LINES = [
  "T — 조작을 시작합니다. 마우스가 화면에 잠기고, Esc 로 풀 수 있습니다.",
  "W A S D 로 걷고, Shift 를 누른 채로 달립니다. Space 는 점프, C 는 앉기.",
  "화면 가운데 점으로 겨냥하고 E — 줍기 · 누르기 · 열기 · 쓰기.",
  "막히면 H. 모아 둔 쪽지와 힌트함을 언제든 다시 펼쳐 볼 수 있습니다.",
  "V 로 1인칭과 3인칭을 오갈 수 있습니다. 편한 쪽으로 두세요.",
];
const WORLD_LINES = [
  "왜곡 — 장소 · 사람 · 사건 · 기억 · 기록 사이의 관계를 뒤틀고 끊어 놓는 원인 불명의 현상.",
  "왜곡은 한 번에 모두 지우지 않는다. 먼저 사라진 것과 남은 것 사이의 차이가 단서가 된다.",
  "하나의 정보만으로 진실을 확정하지 마세요. 서로 다른 출처의 흔적이 일치하는지 확인합니다.",
  "왜곡 이후 새로 남긴 기록은 지워지지 않는다 — 본부가 인원 · 시간 · 현장을 모두 기록하는 이유.",
  "Anchor — 왜곡 속에서도 원형을 비교적 지킨 흔적. 교차 검증을 거쳐 복원의 기준이 됩니다.",
  "복원은 과거를 바꾸는 일이 아니다. 끊어진 관계를 원래 맥락으로 되돌리는 일이다.",
  "합동수사본부 — 30년 전 최초의 왜곡 이후 정부가 세운 비공개 대응 조직.",
];
const NAJU_LINES = [
  "합동수사본부 · 텔레포트 승인",
  "좌표 고정 — NAJU-01 · 영산포 앙암바위",
  "왜곡영역 진입… 저항성 확인됨",
  "텔레포트 장치는 출발 좌표와 지정된 왜곡 좌표 사이만 잇는다. 자유로운 순간이동이 아니다.",
  "현장이 위험해지면 귀환 단말로 언제든 처음 출발한 좌표로 돌아올 수 있습니다.",
  "맥락 동화 — 왜곡 안의 사람은 시대가 뒤섞인 모순을 자연스러운 현실로 받아들일 수 있다.",
];

/** 두 종류 문장을 번갈아 엮는다 — 한 종류만 연달아 나오면 지루하다 */
function interleave(first: readonly string[], second: readonly string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    if (first[i]) result.push(first[i]);
    if (second[i]) result.push(second[i]);
  }
  return result;
}

interface LoadingSequence {
  /** 한 번만 트는 영상들 */
  intro: ClipId[];
  /** 그 뒤 준비될 때까지 도는 영상들 */
  loop: ClipId[];
  /** 오프닝 — 준비되면 SKIP 을 띄우고, 끝까지 보거나 SKIP 을 눌러야 걷힌다 */
  isOpening?: boolean;
  tag: string;
  title: string;
  subtitle: string;
  lines: string[];
  /** 최소 시간(초) — 너무 빨리 걷혀 「번쩍」 이 되지 않게 */
  minSeconds: number;
}

export const SEQUENCES: Record<LoadingVideoKind, LoadingSequence> = {
  // 오프닝이 먼저 끝났는데 준비가 안 됐으면 입장 영상(소리 없음)을 돌리며 기다린다
  entry: {
    intro: ["opening"],
    loop: ["entry"],
    isOpening: true,
    tag: "ENTERING · 합동수사본부",
    title: "조사관 등록실",
    subtitle: "현장에 나서기 전, 당신의 모습을 정합니다.",
    lines: [...WORLD_LINES.slice(0, 3), "외형을 정하고 이름을 등록하면 첫 임무가 시작됩니다."],
    minSeconds: 1.4,
  },
  // 다시 접속 — 오프닝 없이 입장 영상(소리 없음)을 돌리며 기다린다. 튜토리얼 처음부터 · 로비 둘 다 이 막
  resume: {
    intro: [],
    loop: ["entry"],
    tag: "RECONNECTING · 합동수사본부",
    title: "조사관 재접속",
    subtitle: "기록을 확인하고 있습니다.",
    lines: WORLD_LINES,
    minSeconds: 1.4,
  },
  tutorial: {
    intro: [],
    loop: ["gyeongju", "yeosu"],
    tag: "DEPLOYING · 첫 임무",
    title: "버려진 역, 비밀 복도",
    subtitle: "조작부터 익히며 들어갑니다.",
    lines: interleave(CONTROL_LINES, WORLD_LINES),
    minSeconds: 3.2,
  },
  naju: {
    intro: ["naju"],
    loop: ["mokpo", "suncheon"],
    tag: "TELEPORT · NAJU-01",
    title: "왜곡영역 진입",
    subtitle: "영산포 앙암바위 — 좌표를 동기화하고 있습니다.",
    lines: [...NAJU_LINES.slice(0, 3), ...interleave(NAJU_LINES.slice(3), WORLD_LINES)],
    minSeconds: 2.4,
  },
};

function isLoadingVideoKind(value: unknown): value is LoadingVideoKind {
  return typeof value === "string" && value in SEQUENCES;
}

/** n 번째로 틀 클립 — intro 를 다 틀면 loop 를 돈다 */
export function getClipAt(sequence: LoadingSequence, index: number): ClipId {
  if (index < sequence.intro.length) return sequence.intro[index];
  return sequence.loop[(index - sequence.intro.length) % sequence.loop.length];
}

/** 한 문장이 머무는 시간(ms, 나타나기·사라지기 포함) */
export const LINE_INTERVAL_MS = 3800;
/** 느린 노트북에서 나주 맵을 처음 받을 때도 넉넉하게(초) */
export const MAX_WAIT_SECONDS = 60;

// 페이지를 건너 이어 틀기
// 넘어가기 직전 「몇 번째 영상의 몇 초 · 몇 번째 문장」 을 sessionStorage 에 적고, 새 페이지가 뜨자마자 읽는다.
// naju01/index.html 의 인라인 스크립트도 이 열쇠를 본다(바탕을 먼저 어둡게).
const HANDOFF_KEY = "kgeseo.loading.handoff.v2";
const HANDOFF_MAX_AGE_MS = 15000;

interface LoadingScene {
  kind: LoadingVideoKind;
  clipIndex: number;
  videoTime: number;
  musicTime: number;
  lineIndex: number;
}

interface Handoff extends LoadingScene {
  writtenAt: number;
}

export interface LoadingVideoState extends LoadingScene {
  keepOpen: boolean;
  /** 켤 때마다 늘어 막을 새로 그린다 */
  serial: number;
}

let state: LoadingVideoState | null = readInitialState();
// 리액트가 그리기 전에 곡을 건다 — 막이 그려질 때까지 기다리면 영상보다 늦게 들린다
if (state) playMusic(state.kind, state.musicTime);
const listeners = new Set<() => void>();
const notifyListeners = () => listeners.forEach((listener) => listener());

let currentScene: () => LoadingScene | null = () => null;

/** 떠 있는 막이 「지금 몇 번째 영상의 몇 초인지」 알려 주는 함수를 건다. 돌려받은 함수로 뗀다. */
export function setSceneReporter(reporter: () => LoadingScene | null): () => void {
  currentScene = reporter;
  return () => {
    currentScene = () => null;
  };
}

// ① 이어받을 장면(나주)  ② 주소의 ?transition=(웹사이트에서 넘어온 입장)
function readInitialState(): LoadingVideoState | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(HANDOFF_KEY);
    if (stored) {
      sessionStorage.removeItem(HANDOFF_KEY); // 새로고침하면 다시 안 뜨게
      const value = JSON.parse(stored) as Partial<Handoff> | null;
      // 이동이 실패하고 한참 뒤 다른 페이지를 연 경우는 버린다
      if (value && isLoadingVideoKind(value.kind) && Date.now() - (value.writtenAt || 0) < HANDOFF_MAX_AGE_MS) {
        // 페이지를 옮기는 동안 흐른 만큼 앞으로 — 장면이 멈췄다 이어지지 않게
        const elapsed = (Date.now() - (value.writtenAt ?? 0)) / 1000;
        return {
          kind: value.kind,
          clipIndex: value.clipIndex || 0,
          videoTime: (value.videoTime || 0) + elapsed,
          musicTime: (value.musicTime || 0) + elapsed,
          lineIndex: value.lineIndex || 0,
          keepOpen: false,
          serial: 1,
        };
      }
    }
  } catch {
    // 저장소를 못 쓰면 이어받기 없이 간다
  }
  const url = new URL(window.location.href);
  const param = url.searchParams.get("transition");
  if (param == null) return null;
  url.searchParams.delete("transition");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  const seconds = Number(param);
  const videoTime = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return { kind: "entry", clipIndex: 0, videoTime, musicTime: 0, lineIndex: 0, keepOpen: false, serial: 1 };
}

/** 막을 켠다 */
export function showLoadingVideo(kind: LoadingVideoKind, { keepOpen = false }: LoadingVideoOptions = {}) {
  state = { kind, clipIndex: 0, videoTime: 0, musicTime: 0, lineIndex: 0, keepOpen, serial: (state?.serial ?? 0) + 1 };
  notifyListeners();
}

/**
 * 웹사이트에서 넘어온 입장(오프닝 이어 틀기)을 짧은 재접속 영상으로 바꾼다 — 저장 단계가 있는 사람(캐릭터를 만든 뒤)은 오프닝을
 * 다시 보지 않는다(미르 11/10). 웹사이트가 먼저 튼 2.6초는 그대로다. 막을 그리기 전에 부른다(본편 main — 저장을 받은 뒤)
 */
export function replaceOpeningWithResume() {
  if (state?.kind !== "entry") return;
  state = { ...state, kind: "resume", clipIndex: 0, videoTime: 0, musicTime: 0, lineIndex: 0 };
  playMusic("resume", 0);
  notifyListeners();
}

/** 지금 장면을 적어 두고 다른 페이지로 옮긴다 — 새 페이지가 같은 장면부터 이어 튼다 */
export function continueLoadingVideoAt(url: string) {
  const scene = currentScene();
  if (scene) {
    try {
      const handoff: Handoff = { ...scene, writtenAt: Date.now() };
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      // 못 적으면 처음부터
    }
  }
  window.location.href = url;
}

export function hideLoadingVideo() {
  state = null;
  notifyListeners();
}

export function useLoadingVideoState(): LoadingVideoState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => null,
  );
}
