import type { CSSProperties } from "react";

import { formatTime } from "./formatTime";
import PlayerIcon from "./PlayerIcon";
import { monoStyle } from "./styles";
import VolumeControl from "./VolumeControl";

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
      <button type="button" className="player__btn" onClick={onTogglePlay} aria-label={playLabel} title={playLabel}>
        <PlayerIcon name={hasEnded ? "replay" : isPlaying ? "pause" : "play"} />
      </button>
      <button
        type="button"
        className="player__btn"
        onClick={() => onSeekBy(-5)}
        aria-label="5초 뒤로 (←)"
        title="5초 뒤로 (←)"
      >
        <PlayerIcon name="back" />
      </button>
      <button
        type="button"
        className="player__btn"
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
        className="player__btn"
        onClick={onToggleFullscreen}
        aria-label={fullscreenLabel}
        title={fullscreenLabel}
      >
        <PlayerIcon name={isFullscreen ? "exitFullscreen" : "fullscreen"} />
      </button>
      {/* 축소 — 모달이 원래 자리로 줄어들고 그 자리에서 영상이 계속 흐른다. */}
      <button
        type="button"
        className="player__btn player__btn--minimize"
        onClick={onClose}
        aria-label="축소해서 페이지로 돌아가기 (Esc)"
        title="축소 (Esc)"
      >
        <PlayerIcon name="minimize" />
      </button>
    </div>
  );
}
