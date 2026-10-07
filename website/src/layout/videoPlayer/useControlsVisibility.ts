import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const CONTROLS_HIDE_DELAY = 2600;

/** 재생 중 마우스가 멈추면 조작 막대를 숨긴다. 진행 줄을 끄는 동안은 숨기지 않는다. */
export function useControlsVisibility(videoRef: RefObject<HTMLVideoElement | null>, isDraggingRef: RefObject<boolean>) {
  const hideTimerRef = useRef(0);
  const [controlsVisible, setControlsVisible] = useState(true);

  const scheduleControlsHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      const element = videoRef.current;
      if (element && !element.paused && !isDraggingRef.current) setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY);
  }, [videoRef, isDraggingRef]);

  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  return { controlsVisible, setControlsVisible, scheduleControlsHide, wakeControls };
}
