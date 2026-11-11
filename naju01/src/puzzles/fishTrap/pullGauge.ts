/**
 * 줄 당기기 게이지 — 막대가 게이지 위를 오가고, 호박빛 칸에 왔을 때 [E] 를 누르면 한 번 당겨진다.
 * 세 번 맞추면 통발이 올라온다. 판마다 어려워진다 — 첫째는 가운데 넓은 칸, 둘째는 칸이 좁아지며 가운데가 아닌 곳으로 옮겨 가고
 * 막대가 빨라진다, 셋째는 더 좁고 더 빠르며 칸이 둘째의 반대편으로 건너간다(미르 11/11 「너무 쉽고 단조롭다」).
 * 놓쳐도 벌은 없다. 당기는 동안은 잠금을 풀어 두고(pointerHold) [Esc] 로 그만둔다 — 통발은 물에 그대로라 다시 당기면 된다.
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { onGameThaw } from "@/engine/input/gamePause";
import { createChangeSignal } from "@/lib/changeSignal";

import { setKeyInterceptor } from "../interaction";
import { beginHold, endHold, isWindowHeld } from "../pointerHold";

export const GAUGE_HITS = 3;

interface GaugeRound {
  /** 칸 너비(게이지 전체의 몫) · 막대가 한쪽 끝에서 다른 끝까지 가는 초 */
  zone: number;
  sweep: number;
  /** 칸 가운데 후보(0~1, 게이지 왼쪽 절반 기준) — 둘째부터는 이 중 하나를 뽑고 왼쪽 · 오른쪽을 정한다. 첫째는 늘 가운데 */
  centers: readonly number[];
}
/**
 * 둘째 · 셋째 판 — 칸 너비 · 오가는 초 · 칸 가운데 후보(왼쪽 절반, 오른쪽은 1 − 값).
 * 칸 안에 머무는 시간: 예전 둘째 0.27 · 셋째 0.20 초(「너무 쉽다」) → 둘째 약 0.20 · 셋째 약 0.12 초. Codex 01 은 셋째 0.22 초를 권했지만
 * 그건 예전과 같아 미르 요청(더 좁게 · 더 빠르게)과 어긋나고, 0.10 초(첫 안)는 처음 하는 사람에게 반사 신경 싸움이라 그 사이로.
 * 셋째 칸은 가장자리로 몰지 않는다(0.24~0.3)
 */
const ROUND_2 = { zone: 0.15, sweep: 1.35, centers: [0.3, 0.36] } as const;
const ROUND_3 = { zone: 0.11, sweep: 1.1, centers: [0.24, 0.3] } as const;
/** 판이 바뀌면 막대가 이만큼(ms) 왼쪽 끝에 머문 뒤 출발한다 — 옮겨 간 칸을 볼 틈(Codex 01, 왼쪽 칸이면 첫 기회가 0.15초 만에 지나갔다) */
const ROUND_LEAD_MS = 350;

/**
 * 판마다. 첫째는 예전 그대로(가운데 · 1.8초 — 11/4 「너무 빠르다」로 맞춘 박자). 둘째 · 셋째는 좁고 빠르게, 칸이 판마다 옮겨 간다.
 * 칸 안에 막대가 머무는 시간 = 너비 × 오가는 초 — 첫째 0.54 · 둘째 ROUND_2 · 셋째 ROUND_3 초
 */
const ROUNDS: GaugeRound[] = [
  { zone: 0.3, sweep: 1.8, centers: [0.5] },
  { zone: ROUND_2.zone, sweep: ROUND_2.sweep, centers: ROUND_2.centers },
  { zone: ROUND_3.zone, sweep: ROUND_3.sweep, centers: ROUND_3.centers },
];

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
  center: ROUNDS[0].centers[0],
  sweep: ROUNDS[0].sweep,
  flash: null,
  flashKey: 0,
};
let handlers: GaugeHandlers | null = null;

const update = (patch: Partial<GaugeState>) => {
  state = { ...state, ...patch };
  signal.notify();
};

/** 둘째 판 칸이 오른쪽이었나 — 셋째는 반대편으로 건너간다 */
let isSecondRight = false;

/** hits 번째 판의 칸 — 막대는 왼쪽 끝에서 새로 출발한다 */
function roundFor(hits: number): Pick<GaugeState, "zone" | "center" | "sweep" | "startedAt"> {
  const round = ROUNDS[Math.min(hits, ROUNDS.length - 1)];
  const left = round.centers[Math.floor(Math.random() * round.centers.length)];
  let center = left;
  if (hits === 1) {
    isSecondRight = Math.random() < 0.5;
    center = isSecondRight ? 1 - left : left;
  } else if (hits >= 2) center = isSecondRight ? left : 1 - left;
  return {
    zone: round.zone,
    center,
    sweep: round.sweep,
    startedAt: performance.now() + (hits > 0 ? ROUND_LEAD_MS : 0),
  };
}

/** 막대 자리 0~1 — 왼쪽 끝에서 출발해 오간다 */
export function gaugeCursor(now: number) {
  // 출발 전(판이 바뀐 직후 잠깐)은 왼쪽 끝에 머문다
  const sweeps = Math.max(0, now - state.startedAt) / 1000 / state.sweep;
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
  beginHold("gauge", "interaction");
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
  endHold("gauge");
}

// [Esc] — 그만두기. 위에 창이 떠 있으면 창이 먼저 닫힌다
if (typeof window !== "undefined")
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && state.active && !isWindowHeld()) stopGauge();
  });

export const isGaugeActive = () => state.active;

export const useGauge = () => useSyncExternalStore(signal.subscribe, () => state);

exposeDevHook("najuGauge", {
  state: () => state,
  isOnZone: () => state.active && isInZone(gaugeCursor(performance.now())),
});
