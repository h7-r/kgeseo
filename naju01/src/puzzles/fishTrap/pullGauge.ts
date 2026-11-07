/**
 * 줄 당기기 게이지 — 막대가 게이지 위를 오가고, 호박빛 칸에 왔을 때 [E] 를 누르면 한 번 당겨진다.
 * 세 번 맞추면 통발이 올라온다. 판마다 어려워진다 — 둘째는 칸이 좁아지고, 셋째는 칸이 옆으로 옮겨 가며 막대도 빨라진다.
 * 놓쳐도 벌은 없다.
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { onGameThaw } from "@/engine/input/gamePause";
import { createChangeSignal } from "@/lib/changeSignal";

import { setKeyInterceptor } from "../interaction";

export const GAUGE_HITS = 3;

interface GaugeRound {
  /** 칸 너비(게이지 전체의 몫) · 칸 가운데(0~1) · 막대가 한쪽 끝에서 다른 끝까지 가는 초 */
  zone: number;
  center: number;
  sweep: number;
}
/** 판마다 — 셋째 칸 자리는 시작할 때 뽑는다(가운데가 아닌 곳) */
// 한쪽 끝까지 1.8초 — 더 빠르면 리듬이 아니라 반사 신경 싸움이 된다(11/4 「너무 빠르다」)
const ROUNDS: GaugeRound[] = [
  { zone: 0.3, center: 0.5, sweep: 1.8 },
  { zone: 0.18, center: 0.5, sweep: 1.5 },
  { zone: 0.16, center: 0.5, sweep: 1.25 },
];
const THIRD_CENTERS = [0.22, 0.3, 0.7, 0.78];

interface GaugeState {
  active: boolean;
  label: string;
  hits: number;
  startedAt: number;
  /** 지금 판의 칸 */
  zone: number;
  center: number;
  sweep: number;
  /** 마지막으로 누른 결과 — 화면이 잠깐 번쩍인다 */
  flash: "hit" | "miss" | null;
  flashKey: number;
}

interface GaugeHandlers {
  onHit: (hits: number) => void;
  onDone: () => void;
}

const signal = createChangeSignal();
let state: GaugeState = {
  active: false,
  label: "",
  hits: 0,
  startedAt: 0,
  zone: ROUNDS[0].zone,
  center: ROUNDS[0].center,
  sweep: ROUNDS[0].sweep,
  flash: null,
  flashKey: 0,
};
let handlers: GaugeHandlers | null = null;

const update = (patch: Partial<GaugeState>) => {
  state = { ...state, ...patch };
  signal.notify();
};

/** hits 번째 판의 칸 — 막대는 왼쪽 끝에서 새로 출발한다 */
function roundFor(hits: number): Pick<GaugeState, "zone" | "center" | "sweep" | "startedAt"> {
  const round = ROUNDS[Math.min(hits, ROUNDS.length - 1)];
  const center = hits >= 2 ? THIRD_CENTERS[Math.floor(Math.random() * THIRD_CENTERS.length)] : round.center;
  return { zone: round.zone, center, sweep: round.sweep, startedAt: performance.now() };
}

/** 막대 자리 0~1 — 왼쪽 끝에서 출발해 오간다 */
export function gaugeCursor(now: number) {
  const sweeps = (now - state.startedAt) / 1000 / state.sweep;
  const phase = sweeps % 2;
  return phase < 1 ? phase : 2 - phase;
}

const isInZone = (cursor: number) => Math.abs(cursor - state.center) <= state.zone / 2;

function handleKey() {
  if (!state.active) return false;
  if (isInZone(gaugeCursor(performance.now()))) {
    const hits = state.hits + 1;
    update({ hits, flash: "hit", flashKey: state.flashKey + 1, ...roundFor(hits) });
    handlers?.onHit(hits);
    if (hits >= GAUGE_HITS) {
      const done = handlers?.onDone;
      stopGauge();
      done?.();
    }
  } else update({ flash: "miss", flashKey: state.flashKey + 1 });
  return true;
}

export function startGauge(label: string, next: GaugeHandlers) {
  handlers = next;
  setKeyInterceptor(handleKey);
  update({ active: true, label, hits: 0, flash: null, ...roundFor(0) });
}

/**
 * 터치 모드에서 얼었다 풀리면(멈춤 · 창) 얼어 있던 시간만큼 막대 출발 시각을 미룬다 —
 * 막대가 「멈춘 자리」에서 다시 움직인다(시간으로 재는 판정이 멈춤 동안 흐르지 않게).
 */
onGameThaw((frozenMs) => {
  if (state.active) update({ startedAt: state.startedAt + frozenMs });
});

export function stopGauge() {
  handlers = null;
  setKeyInterceptor(null);
  update({ active: false });
}

export const isGaugeActive = () => state.active;

export const useGauge = () => useSyncExternalStore(signal.subscribe, () => state);

exposeDevHook("najuGauge", {
  state: () => state,
  isOnZone: () => state.active && isInZone(gaugeCursor(performance.now())),
});
