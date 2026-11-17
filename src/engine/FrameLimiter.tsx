/**
 * 프레임 제한 — 캔버스 안에 둔다. Canvas 의 frameloop 가 "demand" 일 때 화면 갱신 N 번에 한 번씩만 그리게 한다(frameLimit).
 *
 * 상한이 없으면 주사율대로 그린다 — 144 · 240Hz 화면에서는 그만큼 GPU 를 쓴다(베타 11/16 「GPU 100%」).
 * 얼어 있는 동안(frameloop "never")은 invalidate 가 아무 일도 하지 않는다(R3F) — 따로 끌 필요가 없다.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import { estimateRefreshMs, refreshesPerFrame } from "./frameLimit";

/** 이보다 긴 간격은 탭이 가려졌다 돌아온 것 — 주사율 어림에 넣지 않는다 */
const MAX_SAMPLE_MS = 100;
const SAMPLE_COUNT = 90;
/** 이 갱신 수마다 주사율을 다시 어림한다(창을 다른 모니터로 옮겼을 때) */
const ESTIMATE_EVERY = 30;

/** 이번 화면 갱신의 시각 — rAF 콜백이 받는 값과 같다(같은 갱신 안에서 누가 먼저 돌았는지 가린다) */
const frameTime = () => (typeof document !== "undefined" ? (document.timeline?.currentTime as number | null) : null);

export function FrameLimiter({ limit }: { limit: number }) {
  const invalidate = useThree((state) => state.invalidate);
  // every = 갱신 몇 번에 한 번 그리나, tick = 지난 갱신 수, tickTime = 마지막으로 센 갱신의 시각, drawTick = 마지막으로 그린 갱신의 번호
  const pace = useRef({ every: 1, tick: 0, tickTime: -1, drawTick: 0 });

  useFrame(() => {
    const state = pace.current;
    // 이번 갱신을 아래 tick 이 아직 안 셌으면 곧 셀 번호로 적는다(R3F 루프와 tick 중 누가 먼저 도는지는 정해져 있지 않다)
    state.drawTick = frameTime() === state.tickTime ? state.tick : state.tick + 1;
    // 매 갱신마다 그릴 때는 프레임 안에서 다음 프레임을 청한다 — 밖에서 청하면 R3F 가 한 갱신씩 쉬어 절반으로 그린다
    if (limit > 0 && state.every === 1) invalidate();
  });

  useEffect(() => {
    if (!(limit > 0)) return undefined;
    const state = pace.current;
    let frame = 0;
    let last = 0;
    let sinceEstimate = 0;
    const deltas: number[] = [];

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last > 0) {
        const delta = now - last;
        if (delta < MAX_SAMPLE_MS) {
          deltas.push(delta);
          if (deltas.length > SAMPLE_COUNT) deltas.shift();
        }
      }
      last = now;
      sinceEstimate += 1;
      if (sinceEstimate >= ESTIMATE_EVERY) {
        sinceEstimate = 0;
        const refreshMs = estimateRefreshMs(deltas);
        if (refreshMs !== null) state.every = refreshesPerFrame(refreshMs, limit);
      }
      state.tick += 1;
      state.tickTime = now;
      // 청하면 다음 갱신에 그려진다 — 그린 뒤 (every − 1)번째 갱신에 청해야 every 번째에 그린다
      if (state.tick - state.drawTick >= Math.max(1, state.every - 1)) invalidate();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [invalidate, limit]);

  return null;
}
