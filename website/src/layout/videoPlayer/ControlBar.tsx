import {
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { clamp01 } from "@/lib/math";
import { FONT, type CSSVars } from "@/lib/style";

import PlayerIcon, { type IconName } from "./PlayerIcon";

const monoStyle: CSSProperties = { fontFamily: FONT.mono };
const durationStyle: CSSProperties = { opacity: 0.55 };
const spacerStyle: CSSProperties = { flex: 1 };

interface ControlBarProps {
  isPlaying: boolean;
  hasEnded: boolean;
  isFullscreen: boolean;
  volumeLevel: number;
  second: number;
  duration: number;
  onTogglePlay: () => void;
  onSeekBy: (delta: number) => void;
  onToggleMute: () => void;
  onChangeVolume: (value: number, shouldToast: boolean) => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export default function ControlBar({
  isPlaying,
  hasEnded,
  isFullscreen,
  volumeLevel,
  second,
  duration,
  onTogglePlay,
  onSeekBy,
  onToggleMute,
  onChangeVolume,
  onToggleFullscreen,
  onClose,
}: ControlBarProps) {
  const playLabel = isPlaying ? "멈춤 (K)" : "재생 (K)";
  const fullscreenLabel = isFullscreen ? "전체 화면 끝내기 (F)" : "전체 화면 (F)";

  return (
    <div className="player__controls">
      <button type="button" className="player__button" onClick={onTogglePlay} aria-label={playLabel} title={playLabel}>
        <PlayerIcon name={hasEnded ? "replay" : isPlaying ? "pause" : "play"} />
      </button>
      <button
        type="button"
        className="player__button"
        onClick={() => onSeekBy(-5)}
        aria-label="5초 뒤로 (←)"
        title="5초 뒤로 (←)"
      >
        <PlayerIcon name="back" />
      </button>
      <button
        type="button"
        className="player__button"
        onClick={() => onSeekBy(5)}
        aria-label="5초 앞으로 (→)"
        title="5초 앞으로 (→)"
      >
        <PlayerIcon name="forward" />
      </button>

      <VolumeControl volumeLevel={volumeLevel} onToggleMute={onToggleMute} onChange={onChangeVolume} />

      <span className="player__time" style={monoStyle}>
        {formatTime(second)} <span style={durationStyle}>/ {formatTime(duration)}</span>
      </span>

      <span style={spacerStyle} />

      <button
        type="button"
        className="player__button"
        onClick={onToggleFullscreen}
        aria-label={fullscreenLabel}
        title={fullscreenLabel}
      >
        <PlayerIcon name={isFullscreen ? "exitFullscreen" : "fullscreen"} />
      </button>
      {/* 축소 — 모달이 원래 자리로 줄어들고 그 자리에서 영상이 계속 흐른다. */}
      <button
        type="button"
        className="player__button player__button--minimize"
        onClick={onClose}
        aria-label="축소해서 페이지로 돌아가기 (Esc)"
        title="축소 (Esc)"
      >
        <PlayerIcon name="minimize" />
      </button>
    </div>
  );
}

interface VolumeControlProps {
  volumeLevel: number;
  onToggleMute: () => void;
  onChange: (value: number, shouldToast: boolean) => void;
}

/** 단추 = 음소거, 막대 = 크기. 이 칸 위에서 휠을 굴려도 크기가 바뀐다(useWheelControl). */
function VolumeControl({ volumeLevel, onToggleMute, onChange }: VolumeControlProps) {
  const icon: IconName = volumeLevel === 0 ? "mute" : volumeLevel < 0.5 ? "volumeLow" : "volume";
  const muteLabel = volumeLevel === 0 ? "소리 켜기 (M)" : "음소거 (M)";
  const volumeStyle: CSSVars = { "--volume": volumeLevel };
  return (
    <div className="player__volume">
      <button type="button" className="player__button" onClick={onToggleMute} aria-label={muteLabel} title={muteLabel}>
        <PlayerIcon name={icon} />
      </button>
      <input
        type="range"
        className="player__volume-slider"
        min={0}
        max={1}
        step={0.01}
        value={volumeLevel}
        onChange={(event) => onChange(Number(event.target.value), false)}
        aria-label="소리 크기"
        style={volumeStyle}
      />
    </div>
  );
}

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
export function ProgressBar({
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
    return clamp01((clientX - rect.left) / rect.width);
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

/** 초 → "0:07" */
function formatTime(seconds: number): string {
  const safe = !Number.isFinite(seconds) || seconds < 0 ? 0 : seconds;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
