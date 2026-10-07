import { exposeDevHook } from "@/debug/devHooks";
import { settingsStore } from "@/settings/settings";

// 버튼 연타처럼 같은 소리가 겹쳐야 하고 지연이 적어야 해서 <audio> 대신 미리 디코드한 Web Audio 버퍼를 쓴다.
// 이름은 public/sfx 파일 이름을 camelCase 로 옮긴 것. Vite 가 public 을 루트(/)로 서빙한다.
export const SOUND_FILES = {
  boxUp: "/sfx/box_up.mp3",
  boxDown: "/sfx/box_down.mp3",
  chair: "/sfx/chair.mp3",
  paper: "/sfx/paper.mp3",
  lockDial: "/sfx/lock_dial.mp3",
  lockOpen: "/sfx/lock_open.mp3",
  drawerOpen: "/sfx/drawer_open.mp3",
  drawerClose: "/sfx/drawer_close.mp3",
  canDrink: "/sfx/can_drink.mp3",
  canDrop: "/sfx/can_drop.mp3",
  button: "/sfx/button.mp3",
  drip: "/sfx/drip.mp3",
  cupDrop: "/sfx/cup_drop.mp3",
  cupDown: "/sfx/cup_down.mp3",
  trainOpen: "/sfx/train_open.mp3",
  trainClose: "/sfx/train_close.mp3",
  run: "/sfx/run.mp3",
  // 소화전이 잠겨 안 열릴 때
  locked: "/sfx/locked.mp3",
  // 밸브가 풀려 음료 자판기가 밀려날 때
  vendingOff: "/sfx/vending_off.mp3",
} as const;

export type SoundName = keyof typeof SOUND_FILES;

export interface PlaySoundOptions {
  volume?: number;
  rate?: number;
}

export interface LoopOptions {
  volume?: number;
}

type AudioContextConstructor = typeof AudioContext;

const hasWindow = typeof window !== "undefined";
let context: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const loading = new Map<SoundName, Promise<AudioBuffer | null>>();

let master: GainNode | null = null;

/** 모든 효과음이 지나는 마스터 볼륨. 설정의 효과음 크기를 곧바로 따라간다. */
function sfxOutput(ctx: AudioContext) {
  if (!master) {
    master = ctx.createGain();
    master.gain.value = settingsStore.get().sfxVolume;
    master.connect(ctx.destination);
    settingsStore.subscribe((settings) => {
      if (master) master.gain.value = settings.sfxVolume;
    });
  }
  return master;
}

function getContext() {
  if (!hasWindow) return null;
  if (!context) {
    const AudioContextClass: AudioContextConstructor | undefined =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
  }
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
}

function load(name: SoundName): Promise<AudioBuffer | null> {
  const cached = buffers.get(name);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(name);
  if (pending) return pending;
  const url = SOUND_FILES[name];
  if (!url || !hasWindow) return Promise.resolve(null);
  const promise = fetch(url)
    .then((response) => response.arrayBuffer())
    .then(
      (data) =>
        new Promise<AudioBuffer | null>((resolve) => {
          const ctx = getContext();
          if (!ctx) {
            resolve(null);
            return;
          }
          // 콜백형 decodeAudioData — 옛 사파리 호환
          ctx.decodeAudioData(
            data,
            (buffer) => {
              buffers.set(name, buffer);
              resolve(buffer);
            },
            () => resolve(null),
          );
        }),
    )
    .catch(() => null);
  loading.set(name, promise);
  return promise;
}

/** 모든 효과음을 미리 디코드한다. 사용자 입력 전에도 된다. */
export function preloadSounds() {
  for (const name of Object.keys(SOUND_FILES) as SoundName[]) void load(name);
}

/** 한 번 재생(겹침 허용). 버퍼가 아직 없으면 불러오기만 하고 이번은 건너뛴다. */
export function playSound(name: SoundName, { volume = 1, rate = 1 }: PlaySoundOptions = {}) {
  const ctx = getContext();
  if (!ctx) return null;
  const buffer = buffers.get(name);
  if (!buffer) {
    void load(name);
    return null;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(sfxOutput(ctx));
  source.start();
  return source;
}

const loops = new Map<SoundName, { source: AudioBufferSourceNode; gain: GainNode }>();

/** 반복 재생(발소리·물방울). 이미 돌고 있으면 그대로 둔다. */
export function startLoop(name: SoundName, { volume = 1 }: LoopOptions = {}) {
  if (loops.has(name)) return;
  const ctx = getContext();
  if (!ctx) return;
  const buffer = buffers.get(name);
  if (!buffer) {
    void load(name).then(() => startLoop(name, { volume }));
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(sfxOutput(ctx));
  source.start();
  loops.set(name, { source, gain });
}

export function stopLoop(name: SoundName) {
  const loop = loops.get(name);
  if (!loop) return;
  try {
    loop.source.stop();
  } catch {
    // 이미 멈춘 소스
  }
  loops.delete(name);
}

export function isLooping(name: SoundName) {
  return loops.has(name);
}

// 브라우저는 첫 입력 전에는 소리를 막는다. 파일은 지금 받아 두고 컨텍스트는 첫 입력에 깨운다.
if (hasWindow) {
  preloadSounds();
  const wake = () => {
    getContext();
  };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", wake);
  exposeDevHook("sound", { playSound, startLoop, stopLoop });
}
