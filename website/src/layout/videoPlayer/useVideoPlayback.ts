import { useCallback, useEffect, useState, type RefObject } from "react";

import type { IconName } from "./PlayerIcon";
import { rememberedAudio } from "./useVolume";

interface PlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  startTime: number;
  setMuted: (muted: boolean) => void;
  setControlsVisible: (visible: boolean) => void;
  showToast: (icon: IconName, text: string) => void;
  wakeControls: () => void;
}

/** 재생·멈춤·장면 옮기기와, 그 상태를 화면에 비추는 일. */
export function useVideoPlayback({
  videoRef,
  trackRef,
  startTime,
  setMuted,
  setControlsVisible,
  showToast,
  wakeControls,
}: PlaybackOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [second, setSecond] = useState(Math.floor(startTime)); // 1초마다만 바뀌어 다시 그리기를 줄인다.

  // 보던 장면부터, 소리와 함께.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.volume = rememberedAudio.volume;
    element.muted = rememberedAudio.muted;
    const start = () => {
      try {
        element.currentTime = Math.min(startTime, Math.max(0, (element.duration || startTime) - 0.1));
      } catch {
        // 자리를 옮길 수 없으면 처음부터 튼다.
      }
      setDuration(element.duration || 0);
      element.play().catch(() => {
        // 소리 있는 자동 재생이 막히면 소리 없이라도 튼다. 소리 단추로 켤 수 있다.
        element.muted = true;
        setMuted(true);
        element.play().catch(() => {});
      });
    };
    if (element.readyState >= 1) start();
    else element.addEventListener("loadedmetadata", start, { once: true });

    // 진행 줄은 상태 대신 CSS 변수로 매 프레임 직접 칠한다 — 초당 60번 다시 그리지 않게.
    let frame = 0;
    const paintProgress = () => {
      frame = requestAnimationFrame(paintProgress);
      const track = trackRef.current;
      if (!track || !element.duration) return;
      track.style.setProperty("--progress", String(element.currentTime / element.duration));
      if (element.buffered.length) {
        track.style.setProperty(
          "--buffered",
          String(element.buffered.end(element.buffered.length - 1) / element.duration),
        );
      }
      const currentSecond = Math.floor(element.currentTime);
      setSecond((previous) => (previous === currentSecond ? previous : currentSecond));
    };
    frame = requestAnimationFrame(paintProgress);

    const handlePlay = () => {
      setIsPlaying(true);
      setHasEnded(false);
    };
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setHasEnded(true);
      setControlsVisible(true);
    };
    const handleDurationChange = () => setDuration(element.duration || 0);
    element.addEventListener("play", handlePlay);
    element.addEventListener("pause", handlePause);
    element.addEventListener("ended", handleEnded);
    element.addEventListener("durationchange", handleDurationChange);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("loadedmetadata", start);
      element.removeEventListener("play", handlePlay);
      element.removeEventListener("pause", handlePause);
      element.removeEventListener("ended", handleEnded);
      element.removeEventListener("durationchange", handleDurationChange);
    };
  }, [startTime, videoRef, trackRef, setMuted, setControlsVisible]);

  const togglePlay = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused || element.ended) {
      if (element.ended) element.currentTime = 0;
      element.play().catch(() => {});
      showToast("play", "");
    } else {
      element.pause();
      showToast("pause", "");
    }
    wakeControls();
  }, [videoRef, showToast, wakeControls]);

  const seekBy = useCallback(
    (delta: number) => {
      const element = videoRef.current;
      if (!element || !element.duration) return;
      element.currentTime = Math.max(0, Math.min(element.duration - 0.05, element.currentTime + delta));
      showToast(delta > 0 ? "forward" : "back", `${delta > 0 ? "+" : "−"}${Math.abs(delta)}초`);
      wakeControls();
    },
    [videoRef, showToast, wakeControls],
  );

  return { isPlaying, hasEnded, duration, second, togglePlay, seekBy };
}
