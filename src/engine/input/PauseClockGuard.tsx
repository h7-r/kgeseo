/**
 * 얼렸다 풀 때 3D 시계가 처음으로 돌아가지 않게 한다. 캔버스 안에 둔다.
 *
 * R3F 의 setFrameloop() 는 never 로 들어갈 때도 나올 때도 clock.elapsedTime 을 0 으로 만든다
 * (`@react-three/fiber` events-*.esm.js 의 setFrameloop). 그대로 두면 멈췄다 풀 때마다 연출 시간이 처음으로 돌아간다.
 * 그래서 프레임마다 경과 시간을 적어 두고, frameloop 가 바뀌는 그 순간(스토어 set 안에서 동기로 불림) 되돌린다.
 * 다시 돌 때는 clock.start() 가 「지난번」을 지금으로 잡아 두므로 첫 프레임 dt 도 작다.
 * frameloop 는 Canvas 의 prop 한 곳에서만 바꾼다 — 여기서 직접 바꾸면 다음 렌더에 prop 이 되돌려 버린다.
 */
import { useFrame, useStore } from "@react-three/fiber";
import { useEffect, useRef } from "react";

export function PauseClockGuard() {
  const store = useStore();
  const lastElapsed = useRef(0);

  useFrame((state) => {
    lastElapsed.current = state.clock.elapsedTime;
  });

  useEffect(() => {
    let previous = store.getState().frameloop;
    return store.subscribe((state) => {
      if (state.frameloop === previous) return;
      previous = state.frameloop;
      state.clock.elapsedTime = lastElapsed.current;
    });
  }, [store]);

  return null;
}
