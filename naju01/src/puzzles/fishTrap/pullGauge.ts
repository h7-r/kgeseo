/**
 * 줄 당기기 게이지 — 막대가 게이지 위를 오가고, 호박빛 칸에 왔을 때 [E] 를 누르면 한 번 당겨진다.
 * 세 번 맞추면 통발이 올라온다. 판마다 어려워진다 — 첫째는 가운데 넓은 칸, 둘째는 칸이 좁아지며 가운데가 아닌 곳으로 옮겨 가고
 * 막대가 빨라진다, 셋째는 더 좁고 더 빠르며 칸이 둘째의 반대편으로 건너간다(미르 11/11 「너무 쉽고 단조롭다」).
 * 판이 바뀌어도 막대는 서지 않고 맞힌 자리 · 방향 그대로 새 판 빠르기로 이어 간다(미르 11/12 「멈칫하는 거 없이 바로」, gaugeMath).
 * 놓쳐도 벌은 없다. 당기는 동안은 잠금을 풀어 두고(pointerHold) [Esc] 로 그만둔다 — 통발은 물에 그대로라 다시 당기면 된다.
 */
import { useSyncExternalStore } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import { isGameFrozen, onGameThaw } from "@/engine/input/gamePause";
import { createChangeSignal } from "@/lib/changeSignal";

import { setKeyInterceptor } from "../interaction";
import { beginHold, endHold, isWindowHeld } from "../pointerHold";
import { continuedStart, cursorAt, pickZone, type ZoneChoice } from "./gaugeMath";

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
 * 11/11 「너무 쉽다」로 칸 안 머묾을 둘째 0.20 · 셋째 0.12 초로 줄였고, 11/12 「속도가 전체적으로 좀 더」 → 해 보고 「조금 더 빠르게」로
 * 세 판 다 빠르게(1.8 · 1.35 · 1.1 → 1.5 · 1.15 · 0.95 → 1.3 · 1.0 · 0.85 초, 처음보다 막대 빠르기 +38 · +35 · +29%).
 * 셋째는 머묾이 0.10 초 아래(처음 하는 사람에게 반사 신경 싸움)로 내려가지 않게 칸을 0.11 → 0.13 으로 넓혀 0.11 초(나주통발 02회차 Codex).
 * 셋째 칸은 가장자리로 몰지 않는다(0.24~0.3)
 */
const ROUND_2 = { zone: 0.15, sweep: 1.0, centers: [0.3, 0.36] } as const;
const ROUND_3 = { zone: 0.13, sweep: 0.85, centers: [0.24, 0.3] } as const;
/**
 * 판이 바뀌면 막대는 이어서 움직인다 — 새 칸은 막대가 닿기까지 이만큼(초) 넘게 남는 자리로(옮겨 간 칸을 볼 틈, 예전엔 왼쪽 끝에서 0.35 초 섰다).
 * 못 채우면 가장 먼 자리(0.2 초 남짓) — 셋째는 둘째의 반대편으로 묶여 있고, 둘째도 첫 칸 가장자리에서 맞히면 빠듯하다
 */
const MIN_REACH_SECONDS = 0.3;

/**
 * 판마다. 첫째는 가운데 넓은 칸, 둘째 · 셋째는 좁고 빠르게, 칸이 판마다 옮겨 간다.
 * 칸 안에 막대가 머무는 시간 = 너비 × 오가는 초 — 첫째 0.39 · 둘째 0.15 · 셋째 0.11 초
 */
const ROUNDS: GaugeRound[] = [
  { zone: 0.3, sweep: 1.3, centers: [0.5] },
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

/** 첫 판 — 가운데 칸, 막대는 왼쪽 끝에서 바로 출발한다 */
function firstRound(now: number): Pick<GaugeState, "zone" | "center" | "sweep" | "startedAt"> {
  const round = ROUNDS[0];
  return { zone: round.zone, center: round.centers[0], sweep: round.sweep, startedAt: now };
}

/**
 * 맞힌 뒤 hits 번째 판 — 막대는 지금 자리 · 방향 그대로 새 빠르기로 잇는다(왼쪽 끝으로 옮기거나 세우지 않는다).
 * 칸: 둘째는 좌우 아무 쪽, 셋째는 둘째의 반대편 — 그중 막대가 닿기까지 시간이 남는 자리(gaugeMath.pickZone)
 */
function nextRound(hits: number, now: number): Pick<GaugeState, "zone" | "center" | "sweep" | "startedAt"> {
  const round = ROUNDS[Math.min(hits, ROUNDS.length - 1)];
  const cursor = cursorAt(now - state.startedAt, state.sweep);
  const sides = hits === 1 ? [false, true] : [!isSecondRight];
  const candidates: ZoneChoice[] = sides.flatMap((isRight) =>
    round.centers.map((left) => ({ center: isRight ? 1 - left : left, isRight })),
  );
  const choice = pickZone(candidates, round.zone, cursor, round.sweep, MIN_REACH_SECONDS);
  if (hits === 1) isSecondRight = choice.isRight;
  return {
    zone: round.zone,
    center: choice.center,
    sweep: round.sweep,
    startedAt: continuedStart(now, cursor, round.sweep),
  };
}

/** 막대 자리 0~1 — 왼쪽 끝에서 출발해 오간다 */
export const gaugeCursor = (now: number) => cursorAt(now - state.startedAt, state.sweep).position;

const isInZone = (cursor: number) => Math.abs(cursor - state.center) <= state.zone / 2;

function handleKey() {
  if (!state.active) return false;
  // 터치 멈춤(창 · 메뉴) 동안은 막대도 서 있다 — 그 사이 누른 것은 판정하지 않는다(02회차 Codex)
  if (isGameFrozen()) return false;
  const now = performance.now();
  if (isInZone(gaugeCursor(now))) {
    const hits = state.hits + 1;
    const isLast = hits >= GAUGE_HITS;
    // 마지막이면 다음 판을 만들지 않고 끝낸다
    update({ hits, flash: "hit", flashKey: state.flashKey + 1, ...(isLast ? {} : nextRound(hits, now)) });
    handlers?.onHit(hits);
    if (isLast) {
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
  update({ active: true, label, hits: 0, flash: null, ...firstRound(performance.now()) });
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
