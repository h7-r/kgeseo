/**
 * 얼어 있는 동안(frameloop "never") 캔버스 크기 · 픽셀비가 바뀌면 그 장면을 한 번 다시 그린다. 캔버스 안에 둔다.
 *
 * 멈춤(ESC 메뉴 · 창 · 터치 멈춤)은 렌더를 세운다(gamePause → Canvas frameloop). 그 사이 캔버스 크기가 바뀌면 WebGL 버퍼가 새로 잡혀
 * 비워지는데 다시 그리는 프레임이 없어 메뉴 뒤가 까맣게 남았다(미르 11/11 플레이테스트 「물굴 퍼즐을 마친 뒤 ESC 를 누르면 화면이 까매진다」).
 * 크기가 바뀌는 때 — 화질 「자동」이 무거운 장면 뒤 해상도 배율을 내림(PerformanceMonitor → dpr) · 창 크기 · 메뉴에서 연 설정의 해상도.
 * 다시 그릴 때 시각은 지금 그대로 넘긴다 — 얼어 있는 동안 R3F 는 넘긴 시각과 시계의 차를 dt 로 쓰므로 dt 0 이라 게임은 한 걸음도 안 간다
 * (후처리까지 평소 그대로 그린다). 크기를 다시 잡는 일(gl.setSize · 후처리 setSize)이 끝난 다음 프레임에 그린다.
 */
import { useStore, useThree } from "@react-three/fiber";
import { useEffect } from "react";

export function FrozenRedraw() {
  const store = useStore();
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const dpr = useThree((state) => state.viewport.dpr);

  useEffect(() => {
    if (store.getState().frameloop !== "never") return undefined;
    const frame = requestAnimationFrame(() => {
      const state = store.getState();
      if (state.frameloop !== "never") return;
      state.advance(state.clock.elapsedTime);
    });
    return () => cancelAnimationFrame(frame);
  }, [store, width, height, dpr]);

  return null;
}
