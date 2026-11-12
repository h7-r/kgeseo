/**
 * 전환 로딩 영상 막. 본편 main 과 나주 main 에 한 번씩 둔다.
 * 걷는 조건은 최소 시간 + readinessCheck 의 「다 떴다」 둘 다다(오프닝은 SKIP·끝까지 보기도).
 *
 * 휴대폰(터치 모드)은 세로이거나 첫 탭 전이면 영상 · 문장 · 최소 시간을 멈춰 둔다(landscape.isMediaHeld) — 첫 1회 오프닝을
 * 회전 안내 뒤로 흘려보내지 않게. 내려받기 · 장면 준비는 계속한다. 첫 탭 전에는 「화면을 눌러 입장/계속」을 띄우고,
 * 그 탭 안에서 소리와 함께 틀고 전체 화면을 건다(11/7 미르 · 코덱스 13회차). PC 는 그대로다.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useProgress } from "@react-three/drei";

import {
  canRequestFullscreen,
  isMediaHeld,
  passFirstTap,
  subscribeLandscape,
  useLandscapeState,
} from "@/engine/input/landscape";

import {
  CLIPS,
  LINE_INTERVAL_MS,
  MAX_WAIT_SECONDS,
  SEQUENCES,
  getBgmVolume,
  getClipAt,
  hideLoadingVideo,
  isClipId,
  getMusicTime,
  playMusic,
  setSceneReporter,
  stopMusic,
  useLoadingVideoState,
  type LoadingVideoState,
} from "./loadingVideo";
import { betaLog } from "@/beta/betaLog";

import { READY, waitUntilReady } from "./readinessCheck";

export default function LoadingVideoOverlay() {
  const state = useLoadingVideoState();
  if (!state) return null;
  return <LoadingCurtain key={state.serial} {...state} />;
}

type LoadingCurtainProps = Omit<LoadingVideoState, "serial">;

function LoadingCurtain({
  kind,
  clipIndex: initialClipIndex,
  videoTime: initialVideoTime,
  musicTime: initialMusicTime,
  lineIndex: initialLineIndex,
  keepOpen,
}: LoadingCurtainProps) {
  const sequence = SEQUENCES[kind] ?? SEQUENCES.tutorial;
  const { active: isLoading } = useProgress();
  const isLoadingRef = useRef(isLoading);
  const [isReadyToLift, setIsReadyToLift] = useState(false);
  const [waitingFor, setWaitingFor] = useState("불러오는 중");
  // 오프닝: 준비되면 SKIP 이 뜨고, 오프닝이 끝나야(끝까지 봤거나 SKIP) 걷힌다
  const [isReady, setIsReady] = useState(false);
  const [isOpeningDone, setIsOpeningDone] = useState(!sequence.isOpening);
  const [isSoundBlocked, setIsSoundBlocked] = useState(false);
  const isReadyRef = useRef(false);
  // 베타 기록 — 오프닝을 끝까지 봤나 · 몇 초에 SKIP 했나(미르 11/12). 이 막에서 한 번만
  const isOpeningNotedRef = useRef(false);
  const noteOpening = (phase: "skipped" | "completed", video: HTMLVideoElement | null) => {
    if (!sequence.isOpening || isOpeningNotedRef.current) return;
    isOpeningNotedRef.current = true;
    const seconds = (value: number | undefined) => (Number.isFinite(value) ? Math.round((value ?? 0) * 10) / 10 : null);
    betaLog.track("story_exposure", phase, {
      objective_id: "opening",
      withRun: false,
      // at_sec = 영상 안의 초(웹사이트에서 이어받았으면 그 초부터 흐른 것), from_sec = 이 페이지가 틀기 시작한 초
      data: { at_sec: seconds(video?.currentTime), duration_sec: seconds(video?.duration), from_sec: seconds(initialVideoTime) },
    });
  };
  // 휴대폰: 세로이거나 첫 탭 전이면 잡아 둔다. 잡혀 있는 동안은 걷지 않는다(돌아오면 그때 걷는다)
  const { isTouch, hasFirstTap, wasInterrupted, isMediaHeld: isHeld } = useLandscapeState();
  const needsFirstTap = isTouch && !hasFirstTap;
  const isHeldRef = useRef(isHeld);
  const isLifted = !isHeld && (isReadyToLift || (!!sequence.isOpening && isReady && isOpeningDone));

  // 영상 두 칸을 번갈아 쓴다. 한 칸이 트는 동안 다른 칸이 다음 영상을 미리 받아 두고, 끝나기 0.4초 전에
  // 겹쳐 바꾸면 영상 사이에 검은 틈이 없다(한 칸이면 src 를 바꿀 때마다 깜빡인다).
  const firstVideoRef = useRef<HTMLVideoElement>(null);
  const secondVideoRef = useRef<HTMLVideoElement>(null);
  const videoRefs = [firstVideoRef, secondVideoRef];
  const [deck, setDeck] = useState(() => ({
    front: 0, // 지금 보이는 칸
    clipIndices: [initialClipIndex, initialClipIndex + 1], // 각 칸이 맡은 「n 번째 클립」
  }));
  const isSwitchingRef = useRef(false);
  const pendingStartTimeRef = useRef(initialVideoTime); // 첫 클립만 이 초로 옮겨 시작한다(이어받기)

  const deckRef = useRef(deck);
  const advanceToNextClip = () => {
    if (isSwitchingRef.current) return;
    isSwitchingRef.current = true;
    const back = 1 - deckRef.current.front;
    if (!isHeldRef.current) videoRefs[back].current?.play().catch(() => {});
    setDeck((previous) => ({ ...previous, front: back }));
    // 겹쳐 바뀌는 0.5초가 끝나면 뒤로 간 칸에 그다음 클립을 실어 둔다
    setTimeout(() => {
      setDeck((previous) => {
        const clipIndices = [...previous.clipIndices];
        clipIndices[1 - previous.front] = previous.clipIndices[previous.front] + 1;
        return { ...previous, clipIndices };
      });
      isSwitchingRef.current = false;
    }, 520);
  };

  const [lineIndex, setLineIndex] = useState(initialLineIndex % sequence.lines.length);
  const lineIndexRef = useRef(lineIndex);
  // 타이머·이벤트가 읽는 최신값
  useLayoutEffect(() => {
    isLoadingRef.current = isLoading;
    isReadyRef.current = isReady;
    isHeldRef.current = isHeld;
    deckRef.current = deck;
    lineIndexRef.current = lineIndex;
  });
  // 페이지를 옮기기 직전 「몇 번째 클립 몇 초 · 몇 번째 문장」 을 적는 데 쓴다
  useEffect(() =>
    setSceneReporter(() => ({
      kind,
      clipIndex: deck.clipIndices[deck.front],
      videoTime: videoRefs[deck.front].current?.currentTime || 0,
      musicTime: getMusicTime(),
      lineIndex: (lineIndexRef.current + 1) % sequence.lines.length,
    })),
  );

  // 다음 페이지에서 「뒤로」 로 돌아오면 bfcache 가 덮인 막을 그대로 보여 준다 — 알아채면 걷는다
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) hideLoadingVideo();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  useEffect(() => {
    if (isHeld) return undefined;
    const id = setInterval(() => setLineIndex((i) => (i + 1) % sequence.lines.length), LINE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sequence.lines.length, isHeld]);

  // 잡아 둠이 바뀌면 영상을 멈추거나 잇는다. 구독은 같은 호출 스택에서 불린다 — 첫 탭의 몸짓 안에서 소리와 함께 튼다
  useEffect(() => {
    let wasHeld = isMediaHeld();
    return subscribeLandscape(() => {
      const held = isMediaHeld();
      if (held === wasHeld) return;
      wasHeld = held;
      isHeldRef.current = held;
      const front = deckRef.current.front;
      const frontVideo = (front === 0 ? firstVideoRef : secondVideoRef).current;
      const backVideo = (front === 0 ? secondVideoRef : firstVideoRef).current;
      if (held) {
        frontVideo?.pause();
        backVideo?.pause();
      } else if (frontVideo && !frontVideo.ended) {
        playWithSound(frontVideo, () => setIsSoundBlocked(true));
      }
    });
  }, []);

  useEffect(() => {
    if (keepOpen) return undefined; // 곧 페이지를 옮긴다 — 걷는 건 다음 페이지 몫
    let isCancelled = false;
    // 최소 시간은 실제로 보인 시간으로 잰다 — 휴대폰에서 잡혀 있던(세로 · 첫 탭 전) 동안은 세지 않는다
    let minimumTimer = 0;
    const minimum = new Promise<void>((resolve) => {
      let shownMs = 0;
      let last = performance.now();
      minimumTimer = window.setInterval(() => {
        const now = performance.now();
        if (!isHeldRef.current) shownMs += now - last;
        last = now;
        if (shownMs < sequence.minSeconds * 1000) return;
        window.clearInterval(minimumTimer);
        resolve();
      }, 100);
    });
    const ready = waitUntilReady(
      () => isLoadingRef.current,
      setWaitingFor,
      () => isCancelled,
      {
        maxSeconds: MAX_WAIT_SECONDS,
      },
    );
    // 베타 기록 — 로딩이 끝났다(준비 완료 · 시간 초과). 시각은 이 페이지가 열린 때부터
    void ready.then((status) => {
      if (isCancelled) return;
      betaLog.track("stage_reached", "load_done", {
        withRun: false,
        data: { opening: sequence.isOpening, result: status === READY ? "ready" : "timeout", reason: status === READY ? null : status.slice(0, 80), at_ms: Math.round(performance.now()) },
      });
    });
    void Promise.all([minimum, ready]).then(() => {
      if (isCancelled) return;
      // 두 프레임 더 — 데운 뒤 첫 그림이 실제 화면에 올라간 다음에 걷는다. 오프닝은 SKIP 만 띄운다.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (isCancelled) return;
          if (sequence.isOpening) setIsReady(true);
          else setIsReadyToLift(true);
        }),
      );
    });
    return () => {
      isCancelled = true;
      window.clearInterval(minimumTimer);
    };
  }, [keepOpen, sequence.minSeconds, sequence.isOpening]);

  // 소리가 막혔으면 첫 클릭·키에 켠다(영상은 이미 소리 없이 흐르고 있다)
  useEffect(() => {
    if (!isSoundBlocked) return undefined;
    const unmute = () => {
      for (const video of [firstVideoRef.current, secondVideoRef.current]) {
        const clip = video?.dataset.clip;
        if (video && isClipId(clip) && CLIPS[clip].hasSound) video.muted = false;
      }
      setIsSoundBlocked(false);
    };
    window.addEventListener("pointerdown", unmute, { once: true });
    window.addEventListener("keydown", unmute, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unmute);
      window.removeEventListener("keydown", unmute);
    };
  }, [isSoundBlocked]);

  // 시작 초(이어받기)는 처음 한 번만 쓴다 — 막마다 key 가 새라 두 값은 막이 사는 동안 그대로다
  useEffect(() => {
    playMusic(kind, initialMusicTime || 0);
  }, [kind, initialMusicTime]);

  useEffect(() => {
    if (!isLifted) return undefined;
    stopMusic(1.4);
    // 소리 있는 영상(오프닝)도 막이 사라지는 동안 줄인다 — 뚝 끊기지 않게
    for (const video of [firstVideoRef.current, secondVideoRef.current]) {
      const clip = video?.dataset.clip;
      if (!video || video.muted || !isClipId(clip) || !CLIPS[clip].hasSound) continue;
      const initialVolume = video.volume;
      const startedAt = performance.now();
      const fade = () => {
        const k = Math.min(1, (performance.now() - startedAt) / 700);
        video.volume = initialVolume * (1 - k);
        if (k < 1) requestAnimationFrame(fade);
      };
      requestAnimationFrame(fade);
    }
    const timer = setTimeout(hideLoadingVideo, 750);
    return () => clearTimeout(timer);
  }, [isLifted]);

  const frontClip = CLIPS[getClipAt(sequence, deck.clipIndices[deck.front])];

  return (
    <div
      className="loading-video-overlay"
      role="status"
      aria-live="off"
      aria-label={`${sequence.title} — 불러오는 중`}
      style={{ ...curtainStyle, opacity: isLifted ? 0 : 1, pointerEvents: isLifted ? "none" : "auto" }}
    >
      {[0, 1].map((slot) => {
        const clipId = getClipAt(sequence, deck.clipIndices[slot]);
        const clip = CLIPS[clipId];
        const isFront = deck.front === slot;
        return (
          <video
            key={slot}
            ref={videoRefs[slot]}
            src={clip.url}
            poster={clip.poster}
            data-clip={clipId}
            muted={!clip.hasSound}
            playsInline
            preload="auto"
            aria-hidden="true"
            style={{ ...videoStyle, opacity: isFront ? 1 : 0, zIndex: isFront ? 1 : 0 }}
            onLoadedMetadata={(event) => {
              if (!isFront) return; // 뒤 칸은 받아만 두고 멈춰 있는다
              const video = event.currentTarget;
              const seconds = pendingStartTimeRef.current;
              pendingStartTimeRef.current = 0;
              if (seconds > 0 && seconds < (video.duration || 0) - 0.5) {
                try {
                  video.currentTime = seconds;
                } catch {
                  // 못 옮기면 처음부터
                }
              }
              // 휴대폰에서 잡혀 있으면(세로 · 첫 탭 전) 시작 초만 옮겨 두고 기다린다 — 풀릴 때 구독이 튼다
              if (isHeldRef.current) return;
              playWithSound(video, () => setIsSoundBlocked(true));
            }}
            onTimeUpdate={(event) => {
              if (!isFront) return;
              const video = event.currentTarget;
              if (!video.duration || video.duration - video.currentTime >= 0.4) return;
              // 오프닝이 끝나 간다 — 준비됐으면 그대로 걷고, 아직이면 다음 영상으로 넘어가 기다린다
              if (clipId === "opening") {
                noteOpening("completed", video);
                setIsOpeningDone(true);
                if (isReadyRef.current) return;
              }
              advanceToNextClip();
            }}
            onEnded={(event) => {
              if (!isFront) return;
              if (clipId === "opening") {
                noteOpening("completed", event.currentTarget);
                setIsOpeningDone(true);
                if (isReadyRef.current) return;
              }
              advanceToNextClip();
            }}
          />
        );
      })}
      {/* 오프닝이 흐르는 동안은 글·딱지·어둡게 깔기를 다 뺀다 — 영화처럼 화면만 */}
      {!frontClip.hasSound && <div style={shadeStyle} aria-hidden="true" />}

      {!frontClip.hasSound && (
        <span style={regionBadgeStyle} key={frontClip.label}>
          {frontClip.label}
        </span>
      )}

      {sequence.isOpening && isReady && !isOpeningDone && !needsFirstTap && (
        <button
          type="button"
          className="loading-video-overlay__skip-button"
          style={skipStyle}
          onClick={() => {
            noteOpening("skipped", videoRefs[deckRef.current.front].current);
            setIsOpeningDone(true);
          }}
          aria-label="Skip opening"
        >
          SKIP <span aria-hidden="true">▸▸</span>
        </button>
      )}
      {isSoundBlocked && frontClip.hasSound && <span style={soundHintStyle}>CLICK FOR SOUND</span>}

      {/* 휴대폰 첫 탭 — 이 탭 안에서 소리와 함께 틀고 전체 화면을 건다. 세로면 회전 안내가 위를 덮는다.
          전체 화면이 풀리거나 다른 앱에 다녀오면 다시 뜬다(「화면을 눌러 계속」) */}
      {needsFirstTap && (
        <button type="button" style={firstTapStyle} onClick={passFirstTap}>
          <strong style={firstTapTitleStyle}>
            {kind === "entry" && !wasInterrupted ? "화면을 눌러 입장" : "화면을 눌러 계속"}
          </strong>
          <span style={firstTapBodyStyle}>
            {canRequestFullscreen() ? "전체 화면으로 이어집니다" : "소리와 함께 이어집니다"}
          </span>
        </button>
      )}

      <div style={{ ...textColumnStyle, display: frontClip.hasSound ? "none" : "flex" }}>
        <span style={tagStyle}>{sequence.tag}</span>
        <strong style={titleStyle}>{sequence.title}</strong>
        <span style={subtitleStyle}>{sequence.subtitle}</span>
        <div style={trackStyle} aria-hidden="true">
          <div className="loading-video-overlay__progress-glow" style={glowStyle} />
        </div>
        <span style={statusStyle}>{keepOpen ? "좌표 동기화 중" : waitingFor === READY ? "준비 완료" : waitingFor}</span>
        {/* key 가 바뀌면 새로 그려지며 나타나기 연출이 다시 돈다 */}
        <p key={lineIndex} className="loading-video-overlay__caption" style={lineStyle} aria-live="polite">
          {sequence.lines[lineIndex]}
        </p>
      </div>
      <style>{OVERLAY_CSS}</style>
    </div>
  );
}

/**
 * 소리 있는 영상은 소리를 켜고 튼다. 막히면(새 페이지라 몸짓이 없음) 소리 없이 이어 틀고 알린다 — 첫 입력에 켠다.
 * 늦게 돌아온 실패는 그사이 잡혔으면(세로) 다시 틀지 않는다.
 */
function playWithSound(video: HTMLVideoElement, onSoundBlocked: () => void) {
  const clip = video.dataset.clip;
  const hasSound = isClipId(clip) && !!CLIPS[clip].hasSound;
  if (hasSound) {
    video.muted = false;
    video.volume = getBgmVolume();
  }
  video.play().catch(() => {
    if (!hasSound || isMediaHeld()) return; // 자동 재생이 막혀도 포스터는 보인다
    video.muted = true;
    onSoundBlocked();
    video.play().catch(() => {});
  });
}

// 웹사이트 전환막(website GameTransition)과 같은 자리·같은 글씨
const MONO_FONT = '"IBM Plex Mono", "IBM Plex Sans KR", monospace';
const DISPLAY_FONT = '"Paperlogy", "IBM Plex Sans KR", sans-serif';
const BODY_FONT = '"IBM Plex Sans KR", "Pretendard", "Apple SD Gothic Neo", sans-serif';

const OVERLAY_CSS = `
@keyframes loading-video-overlay-progress-sweep { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.loading-video-overlay__progress-glow { animation: loading-video-overlay-progress-sweep 1.6s cubic-bezier(.4,0,.2,1) infinite; }
/* 문장 하나가 머무는 동안(3.8초): 0.5초 떠오르고 → 머물고 → 0.5초 사라진다 */
@keyframes loading-video-overlay-caption-cycle { 0% { opacity: 0; transform: translateY(6px); } 13% { opacity: 1; transform: none; } 87% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-4px); } }
.loading-video-overlay__caption { animation: loading-video-overlay-caption-cycle ${LINE_INTERVAL_MS}ms ease both; }
@keyframes loading-video-overlay-skip-appear { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.loading-video-overlay__skip-button { animation: loading-video-overlay-skip-appear .5s ease both; transition: background .2s ease, border-color .2s ease; }
.loading-video-overlay__skip-button:hover { background: rgba(255,255,255,0.16) !important; border-color: rgba(255,255,255,0.75) !important; }
.loading-video-overlay__skip-button:focus-visible { outline: 2px solid #9fb2ea; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .loading-video-overlay__skip-button { animation: none; }
  .loading-video-overlay__progress-glow { animation: none; width: 100% !important; opacity: .5; }
  .loading-video-overlay__caption { animation: none; }
}
`;

const curtainStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100000, // 게임 HUD · Leva · 나주 진입 연출(60)보다 위
  background: "#01040a",
  transition: "opacity .7s ease",
  cursor: "progress",
  overflow: "hidden",
};
const videoStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  transition: "opacity .5s ease",
};
const shadeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  background: "linear-gradient(0deg, rgba(1,4,10,0.9) 0%, rgba(1,4,10,0.45) 34%, rgba(1,4,10,0) 58%)",
};
const textColumnStyle: CSSProperties = {
  position: "absolute",
  zIndex: 3,
  left: "clamp(24px, 6vw, 96px)",
  bottom: "clamp(36px, 8vh, 88px)",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  width: "min(640px, calc(100vw - 48px))",
};
const tagStyle: CSSProperties = { fontFamily: MONO_FONT, fontSize: "13px", letterSpacing: "0.18em", color: "#9fb2ea" };
const titleStyle: CSSProperties = {
  fontFamily: DISPLAY_FONT,
  fontWeight: 400,
  fontSize: "clamp(30px, 3.4vw, 46px)",
  lineHeight: 1.15,
  color: "#f1f1fc",
};
const subtitleStyle: CSSProperties = { fontFamily: BODY_FONT, fontSize: "16px", lineHeight: 1.6, color: "#c9d2ee" };
const trackStyle: CSSProperties = {
  marginTop: "10px",
  height: "2px",
  background: "rgba(159,178,234,0.18)",
  borderRadius: "2px",
  overflow: "hidden",
};
const glowStyle: CSSProperties = {
  width: "40%",
  height: "100%",
  background: "linear-gradient(90deg, rgba(58,88,180,0), #9fb2ea, rgba(58,88,180,0))",
};
const lineStyle: CSSProperties = {
  margin: "4px 0 0",
  minHeight: "3.2em", // 두 줄짜리 문장이 와도 위 글이 들썩이지 않게
  fontFamily: BODY_FONT,
  fontSize: "15px",
  lineHeight: 1.6,
  color: "rgba(201,210,238,0.82)",
};
const statusStyle: CSSProperties = {
  fontFamily: MONO_FONT,
  fontSize: "13px",
  letterSpacing: "0.08em",
  color: "rgba(159,178,234,0.6)",
  marginTop: "-4px",
};
const skipStyle: CSSProperties = {
  position: "absolute",
  zIndex: 4,
  // 노치 · 홈 막대 안쪽, 누르는 영역 44px 이상(14회차)
  right: "calc(env(safe-area-inset-right, 0px) + clamp(24px, 4vw, 56px))",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + clamp(20px, 6vh, 64px))",
  minHeight: 44,
  padding: "10px 22px",
  borderRadius: "999px",
  background: "rgba(0,0,0,0.42)",
  border: "1px solid rgba(255,255,255,0.45)",
  color: "#ffffff",
  fontFamily: MONO_FONT,
  fontSize: "14px",
  letterSpacing: "0.18em",
  cursor: "pointer",
};
const soundHintStyle: CSSProperties = {
  position: "absolute",
  zIndex: 4,
  left: "clamp(24px, 4vw, 56px)",
  bottom: "clamp(28px, 6vh, 64px)",
  fontFamily: MONO_FONT,
  fontSize: "12px",
  letterSpacing: "0.16em",
  color: "rgba(255,255,255,0.7)",
};
// 휴대폰 첫 탭 — 화면 전체가 단추다(어디를 눌러도 된다). 포스터 위에 어둡게 깔고 가운데에 글
const firstTapStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 5,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  width: "100%",
  height: "100%",
  padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
  border: "none",
  background: "rgba(1,4,10,0.55)",
  color: "#F2EEE4",
  cursor: "pointer",
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};
const firstTapTitleStyle: CSSProperties = {
  fontFamily: DISPLAY_FONT,
  fontSize: "24px",
  fontWeight: 700,
  letterSpacing: "-0.01em",
};
const firstTapBodyStyle: CSSProperties = { fontFamily: BODY_FONT, fontSize: "15px", opacity: 0.75 };
const regionBadgeStyle: CSSProperties = {
  position: "absolute",
  zIndex: 3,
  top: "clamp(20px, 4vh, 40px)",
  right: "clamp(24px, 4vw, 56px)",
  padding: "6px 14px",
  borderRadius: "999px",
  background: "rgba(5,11,26,0.72)",
  border: "1px solid rgba(111,134,191,0.45)",
  fontFamily: MONO_FONT,
  fontSize: "13px",
  letterSpacing: "0.06em",
  color: "#f1f1fc",
};
