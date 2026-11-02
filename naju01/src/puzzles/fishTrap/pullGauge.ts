/**
 * 줄 당기기 게이지 — 동그라미가 게이지 위를 오가고, 가운데 칸에 왔을 때 [E] 를 누르면 한 번 당겨진다.
 * 세 번 맞추면 통발이 올라온다. 놓쳐도 벌은 없다(어렵지 않게 — 칸을 넓게, 속도는 느긋하게).
 */
import { useSyncExternalStore } from "react";

import { createChangeSignal } from "@/lib/changeSignal";

import { setKeyInterceptor } from "../interaction";

export const GAUGE_HITS = 3;
/** 가운데 칸 너비(게이지 전체의 몫) */
export const GAUGE_ZONE = 0.3;
/** 동그라미가 한쪽 끝에서 다른 끝까지 가는 초 */
const SWEEP_SECONDS = 1.15;

export interface GaugeState {
  active: boolean;
  label: string;
  hits: number;
  startedAt: number;
  /** 마지막으로 누른 결과 — 화면이 잠깐 번쩍인다 */
  flash: "hit" | "miss" | null;
  flashKey: number;
}

interface GaugeHandlers {
  onHit: (hits: number) => void;
  onDone: () => void;
}

const signal = createChangeSignal();
let state: GaugeState = { active: false, label: "", hits: 0, startedAt: 0, flash: null, flashKey: 0 };
let handlers: GaugeHandlers | null = null;

const update = (patch: Partial<GaugeState>) => {
  state = { ...state, ...patch };
  signal.notify();
};

/** 동그라미 자리 0~1 — 왼쪽 끝에서 출발해 오간다 */
export function gaugeCursor(now: number) {
  const t = (now - state.startedAt) / 1000 / SWEEP_SECONDS;
  const f = t % 2;
  return f < 1 ? f : 2 - f;
}

const isInZone = (cursor: number) => Math.abs(cursor - 0.5) <= GAUGE_ZONE / 2;

function handleKey() {
  if (!state.active) return false;
  if (isInZone(gaugeCursor(performance.now()))) {
    const hits = state.hits + 1;
    update({ hits, flash: "hit", flashKey: state.flashKey + 1 });
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
  update({ active: true, label, hits: 0, startedAt: performance.now(), flash: null });
}

export function stopGauge() {
  handlers = null;
  setKeyInterceptor(null);
  update({ active: false });
}

export const isGaugeActive = () => state.active;

export const useGauge = () => useSyncExternalStore(signal.subscribe, () => state);
