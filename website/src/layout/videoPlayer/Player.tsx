import { useRef, type CSSProperties } from "react";

import { FONT } from "@/lib/style";
import type { VideoModalRequest } from "@/state/videoModal";

import ControlBar from "./ControlBar";
import { toPx } from "./geometry";
import PlayerIcon from "./PlayerIcon";
import ProgressBar from "./ProgressBar";
import { monoStyle } from "./styles";
import { useControlsVisibility } from "./useControlsVisibility";
import { useFlipTransition } from "./useFlipTransition";
import { useFullscreen } from "./useFullscreen";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useToast } from "./useToast";
import { useVideoPlayback } from "./useVideoPlayback";
import { useVolume } from "./useVolume";
import { useWheelControl } from "./useWheelControl";

const bodyStyle: CSSProperties = { fontFamily: FONT.body };

interface PlayerProps {
  request: VideoModalRequest;
}

/** 원·카드 자리에서 커져 뜨는 유튜브식 플레이어. */
export default function Player({ request }: PlayerProps) {
  const { video, startTime } = request;
  const backdropRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const { isExpanded, isCollapsing, close, restoreFocus } = useFlipTransition({
    request,
    backdropRef,
    boxRef,
    videoRef,
  });
  const { toast, showToast } = useToast();
  const { controlsVisible, setControlsVisible, scheduleControlsHide, wakeControls } = useControlsVisibility(
    videoRef,
    isDraggingRef,
  );
  const { volumeLevel, setMuted, changeVolume, toggleMute } = useVolume({ videoRef, showToast, wakeControls });
  const { isPlaying, hasEnded, duration, second, togglePlay, seekBy } = useVideoPlayback({
    videoRef,
    trackRef,
    startTime,
    setMuted,
    setControlsVisible,
    showToast,
    wakeControls,
  });
  const { box, isFullscreen, toggleFullscreen } = useFullscreen(boxRef);

  useKeyboardShortcuts({
    boxRef,
    videoRef,
    close,
    togglePlay,
    seekBy,
    changeVolume,
    toggleMute,
    toggleFullscreen,
    scheduleControlsHide,
    restoreFocus,
  });
  useWheelControl({ boxRef, videoRef, seekBy, changeVolume });

  const isIdle = isExpanded && !controlsVisible && isPlaying;
  const playerClassName = [
    "player",
    isExpanded && !isCollapsing && "is-expanded",
    isIdle && "is-hidden",
    isFullscreen && "is-fullscreen",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="player-backdrop"
      ref={backdropRef}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) void close();
      }}
    >
      <div
        ref={boxRef}
        className={playerClassName}
        style={isFullscreen ? undefined : toPx(box)}
        role="dialog"
        aria-modal="true"
        aria-label={`${video.title} 영상`}
        tabIndex={-1}
        onPointerMove={wakeControls}
      >
        <video
          ref={videoRef}
          className="player__video"
          src={video.src}
          poster={video.poster}
          playsInline
          preload="auto"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
        />

        <div className="player__top" aria-hidden={isIdle}>
          <span className="player__eyebrow" style={monoStyle}>
            ESCAPE THE LEGEND · 지역 영상
          </span>
          <span className="player__title" style={bodyStyle}>
            {video.title}
          </span>
        </div>

        {toast && (
          <div key={toast.id} className="player__toast" aria-hidden="true">
            <PlayerIcon name={toast.icon} size={34} />
            {toast.text && <span style={monoStyle}>{toast.text}</span>}
          </div>
        )}
        {hasEnded && (
          <button type="button" className="player__replay" onClick={togglePlay} aria-label="처음부터 다시 보기">
            <PlayerIcon name="replay" size={40} />
          </button>
        )}

        <div className="player__bottom" onPointerDown={(event) => event.stopPropagation()}>
          <ProgressBar
            trackRef={trackRef}
            videoRef={videoRef}
            isDraggingRef={isDraggingRef}
            second={second}
            duration={duration}
            seekBy={seekBy}
            wakeControls={wakeControls}
          />
          <ControlBar
            isPlaying={isPlaying}
            hasEnded={hasEnded}
            isFullscreen={isFullscreen}
            volumeLevel={volumeLevel}
            second={second}
            duration={duration}
            onTogglePlay={togglePlay}
            onSeekBy={seekBy}
            onToggleMute={toggleMute}
            onChangeVolume={changeVolume}
            onToggleFullscreen={toggleFullscreen}
            onClose={() => void close()}
          />
        </div>
      </div>
    </div>
  );
}
