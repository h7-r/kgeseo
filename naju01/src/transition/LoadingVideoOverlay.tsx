/**
 * 전환 로딩 영상 막. 본편 main 과 나주 main 에 한 번씩 둔다.
 * 걷는 조건은 최소 시간 + readinessCheck 의 「다 떴다」 둘 다다(오프닝은 SKIP·끝까지 보기도).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useProgress } from "@react-three/drei";

import {
  CLIPS,
  LINE_INTERVAL_MS,
  MAX_WAIT_SECONDS,
  SEQUENCES,
  bgmVolume,
  clipAt,
  hideLoadingVideo,
  isClipId,
  musicTime,
  playMusic,
  setSceneReporter,
  stopMusic,
  useLoadingVideoState,
  type LoadingVideoState,
} from "./loadingVideo";
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
  const isLifted = isReadyToLift || (!!sequence.isOpening && isReady && isOpeningDone);

  // 영상 두 칸을 번갈아 쓴다. 한 칸이 트는 동안 다른 칸이 다음 영상을 미리 받아 두고, 끝나기 0.4초 전에
  // 겹쳐 바꾸면 영상 사이에 검은 틈이 없다(한 칸이면 src 를 바꿀 때마다 깜빡인다).
  const firstVideo = useRef<HTMLVideoElement>(null);
  const secondVideo = useRef<HTMLVideoElement>(null);
  const videos = [firstVideo, secondVideo];
  const [deck, setDeck] = useState(() => ({
    front: 0, // 지금 보이는 칸
    clipIndices: [initialClipIndex, initialClipIndex + 1], // 각 칸이 맡은 「n 번째 클립」
  }));
  const isSwitching = useRef(false);
  const pendingStartTime = useRef(initialVideoTime); // 첫 클립만 이 초로 옮겨 시작한다(이어받기)

  const deckRef = useRef(deck);
  const advance = () => {
    if (isSwitching.current) return;
    isSwitching.current = true;
    const back = 1 - deckRef.current.front;
    videos[back].current?.play().catch(() => {});
    setDeck((previous) => ({ ...previous, front: back }));
    // 겹쳐 바뀌는 0.5초가 끝나면 뒤로 간 칸에 그다음 클립을 실어 둔다
    setTimeout(() => {
      setDeck((previous) => {
        const clipIndices = [...previous.clipIndices];
        clipIndices[1 - previous.front] = previous.clipIndices[previous.front] + 1;
        return { ...previous, clipIndices };
      });
      isSwitching.current = false;
    }, 520);
  };

  const [lineIndex, setLineIndex] = useState(initialLineIndex % sequence.lines.length);
  const lineIndexRef = useRef(lineIndex);
  // 타이머·이벤트가 읽는 최신값
  useLayoutEffect(() => {
    isLoadingRef.current = isLoading;
    isReadyRef.current = isReady;
    deckRef.current = deck;
    lineIndexRef.current = lineIndex;
  });
  // 페이지를 옮기기 직전 「몇 번째 클립 몇 초 · 몇 번째 문장」 을 적는 데 쓴다
  useEffect(() =>
    setSceneReporter(() => ({
      kind,
      clipIndex: deck.clipIndices[deck.front],
      videoTime: videos[deck.front].current?.currentTime || 0,
      musicTime: musicTime(),
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
    const id = setInterval(() => setLineIndex((i) => (i + 1) % sequence.lines.length), LINE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sequence.lines.length]);

  useEffect(() => {
    if (keepOpen) return undefined; // 곧 페이지를 옮긴다 — 걷는 건 다음 페이지 몫
    let isCancelled = false;
    const minimum = new Promise((resolve) => setTimeout(resolve, sequence.minSeconds * 1000));
    const ready = waitUntilReady(
      () => isLoadingRef.current,
      setWaitingFor,
      () => isCancelled,
      {
        maxSeconds: MAX_WAIT_SECONDS,
      },
    );
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
    };
  }, [keepOpen, sequence.minSeconds, sequence.isOpening]);

  // 소리가 막혔으면 첫 클릭·키에 켠다(영상은 이미 소리 없이 흐르고 있다)
  useEffect(() => {
    if (!isSoundBlocked) return undefined;
    const unmute = () => {
      for (const video of [firstVideo.current, secondVideo.current]) {
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
    for (const video of [firstVideo.current, secondVideo.current]) {
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

  const frontClip = CLIPS[clipAt(sequence, deck.clipIndices[deck.front])];

  return (
    <div
      role="status"
      aria-live="off"
      aria-label={`${sequence.title} — 불러오는 중`}
      style={{ ...curtainStyle, opacity: isLifted ? 0 : 1, pointerEvents: isLifted ? "none" : "auto" }}
    >
      {[0, 1].map((slot) => {
        const clipId = clipAt(sequence, deck.clipIndices[slot]);
        const clip = CLIPS[clipId];
        const isFront = deck.front === slot;
        return (
          <video
            key={slot}
            ref={videos[slot]}
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
              const seconds = pendingStartTime.current;
              pendingStartTime.current = 0;
              if (seconds > 0 && seconds < (video.duration || 0) - 0.5) {
                try {
                  video.currentTime = seconds;
                } catch {
                  // 못 옮기면 처음부터
                }
              }
              if (clip.hasSound) {
                video.muted = false;
                video.volume = bgmVolume();
              }
              video.play().catch(() => {
                // 소리 있는 영상은 새 페이지에서 막힐 수 있다 — 소리 없이 이어 틀고 첫 입력에 켠다
                if (!clip.hasSound) return; // 자동 재생이 막혀도 포스터는 보인다
                video.muted = true;
                setIsSoundBlocked(true);
                video.play().catch(() => {});
              });
            }}
            onTimeUpdate={(event) => {
              if (!isFront) return;
              const video = event.currentTarget;
              if (!video.duration || video.duration - video.currentTime >= 0.4) return;
              // 오프닝이 끝나 간다 — 준비됐으면 그대로 걷고, 아직이면 다음 영상으로 넘어가 기다린다
              if (clipId === "opening") {
                setIsOpeningDone(true);
                if (isReadyRef.current) return;
              }
              advance();
            }}
            onEnded={() => {
              if (!isFront) return;
              if (clipId === "opening") {
                setIsOpeningDone(true);
                if (isReadyRef.current) return;
              }
              advance();
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

      {sequence.isOpening && isReady && !isOpeningDone && (
        <button
          type="button"
          className="opening-skip"
          style={skipStyle}
          onClick={() => setIsOpeningDone(true)}
          aria-label="Skip opening"
        >
          SKIP <span aria-hidden="true">▸▸</span>
        </button>
      )}
      {isSoundBlocked && frontClip.hasSound && <span style={soundHintStyle}>CLICK FOR SOUND</span>}

      <div style={{ ...textColumnStyle, display: frontClip.hasSound ? "none" : "flex" }}>
        <span style={tagStyle}>{sequence.tag}</span>
        <strong style={titleStyle}>{sequence.title}</strong>
        <span style={subtitleStyle}>{sequence.subtitle}</span>
        <div style={trackStyle} aria-hidden="true">
          <div className="loading-glow" style={glowStyle} />
        </div>
        <span style={statusStyle}>{keepOpen ? "좌표 동기화 중" : waitingFor === READY ? "준비 완료" : waitingFor}</span>
        {/* key 가 바뀌면 새로 그려지며 나타나기 연출이 다시 돈다 */}
        <p key={lineIndex} className="loading-line" style={lineStyle} aria-live="polite">
          {sequence.lines[lineIndex]}
        </p>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

// 웹사이트 전환막(website GameTransition)과 같은 자리·같은 글씨
const MONO_FONT = '"IBM Plex Mono", "IBM Plex Sans KR", monospace';
const DISPLAY_FONT = '"Paperlogy", "IBM Plex Sans KR", sans-serif';
const BODY_FONT = '"IBM Plex Sans KR", "Pretendard", "Apple SD Gothic Neo", sans-serif';

const CSS = `
@keyframes loading-glow-flow { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
.loading-glow { animation: loading-glow-flow 1.6s cubic-bezier(.4,0,.2,1) infinite; }
/* 문장 하나가 머무는 동안(3.8초): 0.5초 떠오르고 → 머물고 → 0.5초 사라진다 */
@keyframes loading-line { 0% { opacity: 0; transform: translateY(6px); } 13% { opacity: 1; transform: none; } 87% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-4px); } }
.loading-line { animation: loading-line ${LINE_INTERVAL_MS}ms ease both; }
@keyframes skip-appear { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.opening-skip { animation: skip-appear .5s ease both; transition: background .2s ease, border-color .2s ease; }
.opening-skip:hover { background: rgba(255,255,255,0.16) !important; border-color: rgba(255,255,255,0.75) !important; }
.opening-skip:focus-visible { outline: 2px solid #9fb2ea; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .opening-skip { animation: none; }
  .loading-glow { animation: none; width: 100% !important; opacity: .5; }
  .loading-line { animation: none; }
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
  fontSize: "11px",
  letterSpacing: "0.08em",
  color: "rgba(159,178,234,0.6)",
  marginTop: "-4px",
};
const skipStyle: CSSProperties = {
  position: "absolute",
  zIndex: 4,
  right: "clamp(24px, 4vw, 56px)",
  bottom: "clamp(28px, 6vh, 64px)",
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
