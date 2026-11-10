/**
 * 나주 조사 시간 — 경과 시간 표시 · 시간 별(20분 이내 ★★★ · 넘으면 ★★, 미르 11/11)용.
 * 첫 조작(시작 카드에서 잠금)부터 굿을 풀어낸 순간(다섯 불을 다 켬 — released, 끝 연출은 빼고)까지 게임 시계(gameNow)로 쌓는다 — 창 · 멈춤 · 시작 카드 · 게임 밖(ESC)으로
 * 게임이 얼어 있던 시간은 gameNow 가 이미 뺀다(나주입장 05회차 Codex: 「멈추지 않은 누적 조사 시간」).
 * 이어 하기는 저장 칸(naju.playTime)에서 이어 세고, 처음부터 다시는 naju.* 칸이 지워져 0 부터. 굿 단계가 바뀌는 그 순간에 확정한다
 * (1초 틱에서 확인하면 19:59.5 에 끝낸 판이 20:00 을 넘겨 ★★ 가 됐다 — 06회차 Codex).
 * 서버 기록 · 순위는 아직 없다 — 이 값은 화면 표시와 별 계산 시안용이다(정식 기록 방식은 BE 와 정할 것).
 */
import { gameNow } from "@/engine/input/gameClock";
import { createChangeSignal } from "@/lib/changeSignal";
import { scheduleGameSave } from "@/save/gameSave";

import { gut } from "../puzzles/gut/gutState";

/** 시간 별 ★★★ 의 끝 — 나주 맵 기준(미르 11/11) */
export const THREE_STAR_MS = 20 * 60_000;
/** 화면을 다시 그리는 간격 */
const TICK_MS = 1000;

export interface SavedPlayTime {
  /** 쌓인 조사 시간(ms) */
  ms: number;
  /** 동트기에서 확정했다 — 더 쌓지 않는다 */
  isFinal: boolean;
}

const signal = createChangeSignal();
let total = 0;
let isFinal = false;
/** 지금 쌓는 중이면 마지막으로 더한 게임 시각 */
let lastAt: number | null = null;
let timer = 0;

function settle() {
  if (lastAt === null) return;
  const now = gameNow();
  total += Math.max(0, now - lastAt);
  lastAt = now;
}

/** 마지막으로 저장을 부른 분(分) — 1분마다 한 번 저장(새로 고침 · 탭 닫기에 시간을 잃지 않게) */
let savedMinute = -1;

/** 굿을 풀었다(released) · 끝났다(dawn) — 이 판의 조사는 끝 */
const isCaseSolved = () => gut.stage() === "released" || gut.stage() === "dawn";

function tick() {
  settle();
  const minute = Math.floor(total / 60_000);
  if (minute !== savedMinute) {
    savedMinute = minute;
    scheduleGameSave();
  }
  signal.notify();
}

function finish() {
  settle();
  isFinal = true;
  lastAt = null;
  window.clearInterval(timer);
  timer = 0;
  scheduleGameSave();
  signal.notify();
}

// 굿 단계가 바뀌는 그 순간에 확정한다 — 도는 중일 때만(이어 하기로 끝난 판이 되살아나는 것은 start 가 본다)
gut.subscribe(() => {
  if (lastAt !== null && isCaseSolved()) finish();
});

export const playClock = {
  /** 첫 조작 — 한 번만 시작한다(확정된 판 · 이미 도는 중이면 그대로) */
  start() {
    if (isFinal || lastAt !== null) return;
    if (isCaseSolved()) {
      isFinal = true;
      signal.notify();
      return;
    }
    lastAt = gameNow();
    timer = window.setInterval(tick, TICK_MS);
    signal.notify();
  },
  /** 지금까지 쌓인 시간(ms) */
  elapsed(): number {
    return lastAt === null ? total : total + Math.max(0, gameNow() - lastAt);
  },
  isFinal: () => isFinal,
  isRunning: () => lastAt !== null,
  subscribe: signal.subscribe,
  version: signal.version,
  /** 저장 칸 */
  read(): SavedPlayTime {
    return { ms: Math.round(playClock.elapsed()), isFinal };
  },
  restore(saved: unknown) {
    const value = saved as Partial<SavedPlayTime> | null;
    total = typeof value?.ms === "number" && Number.isFinite(value.ms) && value.ms > 0 ? value.ms : 0;
    isFinal = value?.isFinal === true;
    signal.notify();
  },
};

/** 「12:34」 · 한 시간 넘으면 「1:02:03」 */
export function formatPlayTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
