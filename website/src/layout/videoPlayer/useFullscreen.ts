import { useCallback, useEffect, useState, type RefObject } from "react";

import { targetBox } from "./geometry";

/** 전체 화면 여부와, 전체 화면이 아닐 때 창 크기에 맞춘 상자. */
export function useFullscreen(boxRef: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState(targetBox);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (!document.fullscreenElement) setBox(targetBox());
    };
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener("resize", handleResize);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = boxRef.current;
    if (!element) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else element.requestFullscreen?.().catch(() => {});
  }, [boxRef]);

  return { box, isFullscreen, toggleFullscreen };
}
