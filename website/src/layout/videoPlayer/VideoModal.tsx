import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useVideoModalRequest, type VideoModalRequest } from "@/app/siteState";
import { FONT } from "@/lib/style";

import ControlBar, { ProgressBar } from "./ControlBar";
import PlayerIcon, { type IconName } from "./PlayerIcon";
import { targetBox, toPx, useFlipTransition } from "./useFlipTransition";
import { useKeyboardShortcuts, useWheelControl } from "./usePlayerShortcuts";
import { useVideoPlayback, useVolume } from "./useVideoPlayback";

const monoStyle: CSSProperties = { fontFamily: FONT.mono };
const bodyStyle: CSSProperties = { fontFamily: FONT.body };

/**
 * 원·카드를 누르면 그 자리에서 커지며 뜨는 큰 영상 플레이어. App 에 한 번만 놓는다.
 * 1920 무대는 transform 으로 줄어 있어 그 안에서는 fixed 가 무대 기준이 된다 — body 에 포털로 그린다.
 */
export default function VideoModal() {
  const request = useVideoModalRequest();
  if (!request) return null;
  // 새로 열 때마다(다른 영상·다른 장면) 상태를 처음부터.
  return createPortal(<Player key={`${request.video.src}@${request.startTime}`} request={request} />, document.body);
}

interface PlayerProps {
  request: VideoModalRequest;
}

/** 원·카드 자리에서 커져 뜨는 유튜브식 플레이어. */
function Player({ request }: PlayerProps) {
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

const TOAST_DURATION = 700;

interface Toast {
  icon: IconName;
  text: string;
  id: number;
}

/** "+2초" "소리 60%" 같은 표시를 가운데 잠깐 띄운다. */
function useToast() {
  const toastTimerRef = useRef(0);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((icon: IconName, text: string) => {
    clearTimeout(toastTimerRef.current);
    setToast({ icon, text, id: Date.now() });
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  return { toast, showToast };
}

const CONTROLS_HIDE_DELAY = 2600;

/** 재생 중 마우스가 멈추면 조작 막대를 숨긴다. 진행 줄을 끄는 동안은 숨기지 않는다. */
function useControlsVisibility(videoRef: RefObject<HTMLVideoElement | null>, isDraggingRef: RefObject<boolean>) {
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

/** 전체 화면 여부와, 전체 화면이 아닐 때 창 크기에 맞춘 상자. */
function useFullscreen(boxRef: RefObject<HTMLDivElement | null>) {
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
