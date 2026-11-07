/**
 * 게임 시계 — 「전부 멈춤」(터치 모드) 동안 흐르지 않는 시각과 타이머(코덱스 구현 01회차 2절).
 *
 * 연출 · 진행 판정(자판기 컷신 단계, 출동 카운트다운, 능선 단계 경과, 궤 열기, 지연 안내 · 큐)이 실제 시각
 * (performance.now · setTimeout)을 쓰면, 멈춘 동안에도 시간이 흘러 돌아오자마자 단계를 건너뛴다.
 * 그런 곳만 이 시계로 바꾼다. 저장 시각 · 통신 제한 시간 · 성능 측정은 실제 시각 그대로 둔다.
 * PC(터치 모드가 아님)는 얼 일이 없어 실제 시각과 똑같다.
 */
import { onGameFreeze, onGameThaw } from "./gamePause";

let frozenSince: number | null = null;
let frozenTotal = 0;

/** performance.now() 와 같은 단위(ms)지만 얼어 있던 시간은 빼고 센다 */
export function gameNow(): number {
  return (frozenSince ?? performance.now()) - frozenTotal;
}

interface GameTimer {
  callback: () => void;
  remaining: number;
  armedAt: number;
  handle: number;
}

let nextId = 1;
const timers = new Map<number, GameTimer>();

function arm(id: number, timer: GameTimer) {
  timer.armedAt = performance.now();
  timer.handle = window.setTimeout(
    () => {
      timers.delete(id);
      timer.callback();
    },
    Math.max(0, timer.remaining),
  );
}

/** setTimeout 과 같게 쓴다 — 얼어 있는 동안은 남은 시간이 줄지 않는다 */
export function gameSetTimeout(callback: () => void, ms = 0): number {
  const id = nextId++;
  const timer: GameTimer = { callback, remaining: ms, armedAt: 0, handle: 0 };
  timers.set(id, timer);
  if (frozenSince === null) arm(id, timer);
  return id;
}

/** clearTimeout 과 같게 쓴다 */
export function gameClearTimeout(id: number | null | undefined) {
  if (id == null) return;
  const timer = timers.get(id);
  if (!timer) return;
  window.clearTimeout(timer.handle);
  timers.delete(id);
}

onGameFreeze(() => {
  frozenSince = performance.now();
  for (const timer of timers.values()) {
    window.clearTimeout(timer.handle);
    timer.remaining -= frozenSince - timer.armedAt;
  }
});

onGameThaw(() => {
  if (frozenSince !== null) frozenTotal += performance.now() - frozenSince;
  frozenSince = null;
  for (const [id, timer] of timers) arm(id, timer);
});
