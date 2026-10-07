import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { FONT } from "@/lib/style";

import { formatTime } from "./formatTime";

interface ScrubPreview {
  /** 진행 줄 위 마우스 자리(0~1) */
  ratio: number;
  time: number;
}

interface ProgressBarProps {
  /** 재생 쪽이 매 프레임 --progress·--buffered 를 직접 칠한다. */
  trackRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  isDraggingRef: RefObject<boolean>;
  second: number;
  duration: number;
  seekBy: (delta: number) => void;
  wakeControls: () => void;
}

/** 누르거나 끌어 장면을 옮기는 진행 줄. 마우스 자리의 시각을 위에 띄운다. */
export default function ProgressBar({
  trackRef,
  videoRef,
  isDraggingRef,
  second,
  duration,
  seekBy,
  wakeControls,
}: ProgressBarProps) {
  const [scrubPreview, setScrubPreview] = useState<ScrubPreview | null>(null);

  const ratioAt = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = videoRef.current;
    if (!element || !element.duration) return;
    isDraggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    element.currentTime = ratioAt(event.clientX) * element.duration;
    wakeControls();
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = videoRef.current;
    if (!element || !element.duration) return;
    const ratio = ratioAt(event.clientX);
    setScrubPreview({ ratio, time: ratio * element.duration });
    if (isDraggingRef.current) element.currentTime = ratio * element.duration;
  };
  const handlePointerUp = () => {
    isDraggingRef.current = false;
    wakeControls();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(event.key === "ArrowRight" ? 5 : -5);
    }
  };

  return (
    <div
      ref={trackRef}
      className="player__track"
      role="slider"
      tabIndex={0}
      aria-label="재생 위치"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={second}
      aria-valuetext={`${formatTime(second)} / ${formatTime(duration)}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setScrubPreview(null)}
      onKeyDown={handleKeyDown}
    >
      <div className="player__buffered" />
      <div className="player__played" />
      <div className="player__thumb" />
      {scrubPreview && (
        <span className="player__scrub-preview" style={{ left: `${scrubPreview.ratio * 100}%`, fontFamily: FONT.mono }}>
          {formatTime(scrubPreview.time)}
        </span>
      )}
    </div>
  );
}
