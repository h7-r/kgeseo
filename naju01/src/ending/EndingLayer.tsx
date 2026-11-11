/**
 * 나주 엔딩 화면 — 끝 연출 자막 띠(finale) · 전체화면 엔딩 필름(film) · 클리어 화면 + 현장 방문 창(clear). 단계는 endingState.
 * 글 · 그림 · 창 문구는 endingScript 에서만 고친다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isGamePausedFlag } from "@/engine/input/gamePause";
import type { LeaveResult, LeaveToLobbyAction } from "@/game/LeaveToLobby";
import { isGameSaveEnabled } from "@/save/gameSave";

import { RESTART_FAILED_TEXT, restartNajuCase } from "../app/restartNaju";
import { leaveToTrain } from "../app/leaveToLobby";
import { formatPlayTime, playClock } from "../progress/playClock";
import { createMoonPlay } from "../puzzles/cliff/moonPlay";
import { createShadowPlay } from "../puzzles/ridge/shadowPlay";
import { getBgmVolume } from "../transition/loadingVideo";
import { ending, useEndingCaption, useEndingPhase } from "./endingState";
import {
  CLEAR_TEXT,
  ENDING_MUSIC,
  FILM_SHOTS,
  VISIT_TEXT,
  filmShots,
  shotSeconds,
  type FilmShot,
} from "./endingScript";
import "./ending.css";
import { BetaPostSurveyGate } from "@/beta/BetaSurveyCard";

interface EndingLayerProps {
  /** 본편과 한 출처일 때만 — 로비 · 기차로 나간다 */
  leaveAction?: LeaveToLobbyAction;
}

export default function EndingLayer({ leaveAction }: EndingLayerProps) {
  const phase = useEndingPhase();
  if (phase === "finale") return <FinaleBand />;
  if (phase === "film") return <EndingFilm />;
  // 베타 — 결과 · 현장 방문 창보다 먼저 끝난 뒤 설문을 묻는다(참여 코드 · 폼 주소가 없으면 바로 결과 화면)
  if (phase === "clear")
    return (
      <BetaPostSurveyGate>
        <ClearScreen leaveAction={leaveAction} />
      </BetaPostSurveyGate>
    );
  return null;
}

/** 끝 연출 — 위아래 검은 띠와 아래 자막 한 줄(장면에 맞춰 바로 바뀐다). 그동안 필름 그림을 미리 받아 둔다 */
function FinaleBand() {
  const caption = useEndingCaption();
  useEffect(() => {
    for (const shot of FILM_SHOTS) if (shot.kind === "image") new Image().src = shot.src;
  }, []);
  return (
    <div className="naju-ending-band" data-hud="엔딩 자막">
      <div className="naju-ending-band__bar naju-ending-band__bar--top" />
      <div className="naju-ending-band__bar naju-ending-band__bar--bottom">
        {caption && (
          <p key={caption.key} className="naju-ending-band__caption">
            {caption.text}
          </p>
        )}
      </div>
    </div>
  );
}

// ── 전체화면 엔딩 필름 ──

/** 길게 눌러 건너뛰기 — 이만큼(ms) 누르고 있으면 */
const HOLD_TO_SKIP_MS = 900;
/** 이보다 짧게 누른 키는 「다음 장」 */
const TAP_MS = 350;
/** 장이 바뀔 때 겹쳐 바뀌는 시간(초) — ending.css 의 전환과 같게 */
const CROSSFADE_SECONDS = 1;

type Films = { box: ReturnType<typeof createShadowPlay>; moon: ReturnType<typeof createMoonPlay> };

function EndingFilm() {
  const [index, setIndex] = useState(0);
  const [holdLevel, setHoldLevel] = useState(0);
  // 작별을 현장에서 못 봤으면 그 대목을 글로 넣는다(열릴 때 한 번 정한다)
  const [shots] = useState(() => filmShots(ending.wasFarewellShown()));
  const shot = shots[index];
  const isLast = index >= shots.length - 1;
  const films = useRef<Films | null>(null);
  const filmHost = useRef<HTMLDivElement>(null);

  const next = useCallback(() => {
    if (isLast) ending.finishFilm();
    else setIndex((current) => Math.min(current + 1, shots.length - 1));
  }, [isLast, shots.length]);

  // 장 시계 — 화면이 그려질 때만 흐른다(탭을 숨기거나 앱을 바꾸면 필름도 선다. 세계가 멈춘 것과는 따로, Codex).
  // 장 길이가 차면 다음으로. 게임 속 영상(함의 그림자극 · 선바위 영상)은 그 대목만 같은 시계로 다시 튼다 — 플레이어가 본 그 장면
  useEffect(() => {
    let played = 0;
    let last = performance.now();
    let frame = 0;
    let isDone = false;
    const duration = shotSeconds(shot);
    let film: Films[keyof Films] | null = null;
    if (shot.kind === "film") {
      films.current ??= { box: createShadowPlay(), moon: createMoonPlay() };
      film = films.current[shot.film];
      film.prepare();
      film.canvas.className = "naju-ending-film__canvas";
      filmHost.current?.replaceChildren(film.canvas);
      // 앞 대목부터 차례로 그려 둔다 — 선바위 영상의 깨지는 컷은 앞 장면을 쥐고 쓴다(Codex)
      for (let at = 0; at < shot.from; at += 0.25) film.draw(at);
    }
    const tick = (now: number) => {
      // 터치 「멈춤」(앱 전환 · 세로로 돌림) 동안은 필름도 선다 — 세계가 창 때문에 언 것(PC)과는 따로(Codex 리뷰)
      if (!isGamePausedFlag()) played += Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (film && shot.kind === "film") film.draw(Math.min(shot.to, shot.from + played * (shot.speed ?? 1)));
      if (played >= duration && !isDone) {
        isDone = true;
        next();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shot, next]);

  // 다 쓰면 영상 판을 놓는다
  useEffect(
    () => () => {
      for (const film of Object.values(films.current ?? {})) {
        film.texture.dispose();
        film.material.dispose();
        film.mesh.geometry.dispose();
      }
    },
    [],
  );

  useEndingMusic();
  const hold = useHoldToSkip(setHoldLevel);

  // 클릭 · Space · Enter 짧게 = 다음 장, 길게(키 · 단추) = 건너뛰기. 엔딩 동안 다른 단축키(소지품 · 설정 · 상호작용)는 막는다
  const keyDownAt = useRef(0);
  useEffect(() => {
    const isSkipKey = (event: KeyboardEvent) => event.code === "Space" || event.code === "Enter";
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.code === "Escape") event.preventDefault();
      if (!isSkipKey(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      keyDownAt.current = performance.now();
      hold.start();
    };
    // 놓음은 필름 키만 잡는다 — 이동 키를 쥔 채 필름이 열렸을 때 그 놓음을 삼키면 강가로 돌아가 혼자 걷는다(Codex 리뷰)
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isSkipKey(event)) return;
      event.stopImmediatePropagation();
      if (!keyDownAt.current) return;
      const heldFor = performance.now() - keyDownAt.current;
      keyDownAt.current = 0;
      hold.cancel();
      if (heldFor < TAP_MS) next();
    };
    // 키를 쥔 채 창을 벗어나면 그 놓음이 안 온다 — 돌아왔을 때 다 찬 것으로 건너뛰지 않게 거둔다(Codex 리뷰)
    const onLeave = () => {
      keyDownAt.current = 0;
      hold.cancel();
    };
    const onVisibility = () => {
      if (document.hidden) onLeave();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [next, hold]);

  return (
    <div className="naju-ending-film" data-hud="엔딩 필름" onClick={next}>
      {shots.map((each, k) =>
        each.kind === "image" ? (
          <img
            key={each.id}
            // 나가는 장도 사라지는 동안 계속 움직인다(멈추면 겹쳐 바뀔 때 툭 튄다)
            className={`naju-ending-film__image${k === index ? " is-on" : ""}${
              each.pan && (k === index || k === index - 1) ? ` is-moving pan-${each.pan}` : ""
            }`}
            style={{ animationDuration: `${shotSeconds(each) + CROSSFADE_SECONDS}s` }}
            src={each.src}
            alt=""
            draggable={false}
          />
        ) : null,
      )}
      <div ref={filmHost} className={`naju-ending-film__screen${shot.kind === "film" ? " is-on" : ""}`} />
      <div className="naju-ending-film__vignette" />
      {shot.chapter && (
        <div key={`chapter-${shot.id}`} className="naju-ending-film__chapter">
          {shot.part && <span className="naju-ending-film__part">{shot.part}</span>}
          {shot.chapter}
        </div>
      )}
      <FilmCaption shot={shot} />
      <div className="naju-ending-film__controls" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="naju-ending-film__skip"
          onPointerDown={hold.start}
          onPointerUp={hold.cancel}
          onPointerLeave={hold.cancel}
          onPointerCancel={hold.cancel}
          aria-label="길게 눌러 엔딩 건너뛰기"
        >
          <span className="naju-ending-film__skip-fill" style={{ transform: `scaleX(${holdLevel})` }} />
          <span className="naju-ending-film__skip-text">길게 눌러 건너뛰기</span>
        </button>
      </div>
      <div className="naju-ending-film__hint">클릭 · Space 다음 장면</div>
      <div className="naju-ending-film__dots" aria-hidden>
        {shots.map((each, k) => (
          <i key={each.id} className={k === index ? "is-on" : k < index ? "is-past" : undefined} />
        ))}
      </div>
    </div>
  );
}

function FilmCaption({ shot }: { shot: FilmShot }) {
  if (shot.kind === "text")
    return (
      <div key={shot.id} className="naju-ending-film__closing">
        {shot.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    );
  return (
    <div key={shot.id} className="naju-ending-film__caption">
      {shot.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

/** 길게 누르기 — 다 차면 필름을 끝낸다(다 본 것으로 친다) */
function useHoldToSkip(setLevel: (level: number) => void) {
  const frame = useRef(0);
  const startedAt = useRef(0);
  // 필름이 먼저 닫히면(마지막 장이 끝남) 남은 누르기를 거둔다 — 남으면 클리어 화면의 클릭을 삼키거나 화면을 다시 연다(Codex 리뷰)
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return useMemo(() => {
    const cancel = () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      setLevel(0);
    };
    const start = () => {
      if (frame.current) return;
      startedAt.current = performance.now();
      const tick = () => {
        const level = Math.min(1, (performance.now() - startedAt.current) / HOLD_TO_SKIP_MS);
        setLevel(level);
        if (level >= 1) {
          frame.current = 0;
          if (ending.phase() !== "film") return;
          // 손을 떼며 생기는 클릭이 바로 뜬 클리어 화면의 단추를 누르지 않게(Codex)
          swallowNextClick();
          ending.finishFilm();
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    };
    return { start, cancel };
  }, [setLevel]);
}

/** 다음 클릭 하나를 삼킨다(짧은 동안만) */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    window.removeEventListener("click", swallow, { capture: true });
  };
  window.addEventListener("click", swallow, { capture: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
}

/** 엔딩 음악 — 설정의 「배경음악」 크기로, 들어올 때 · 나갈 때 천천히. 탭을 숨기거나 터치 「멈춤」이면 쉰다 */
function useEndingMusic() {
  useEffect(() => {
    const audio = new Audio(ENDING_MUSIC.url);
    const target = getBgmVolume() * ENDING_MUSIC.gain;
    audio.volume = 0;
    audio.loop = false;
    void audio.play().catch(() => {});
    let raf = 0;
    const startedAt = performance.now();
    const fadeIn = () => {
      const t = Math.min(1, (performance.now() - startedAt) / 2500);
      audio.volume = target * t;
      if (t < 1) raf = requestAnimationFrame(fadeIn);
    };
    raf = requestAnimationFrame(fadeIn);
    const sync = () => {
      const shouldPlay = !document.hidden && !isGamePausedFlag();
      if (!shouldPlay && !audio.paused) audio.pause();
      else if (shouldPlay && audio.paused && !audio.ended) void audio.play().catch(() => {});
    };
    const syncTimer = window.setInterval(sync, 250);
    document.addEventListener("visibilitychange", sync);
    // 소리 자동 재생을 막는 브라우저(사파리) — 필름은 연출 예약으로 열려 몸짓이 없다. 다음 클릭 · 키에서 다시 튼다(Codex 리뷰).
    // iOS 웹킷은 터치 pointerdown 을 몸짓으로 안 쳐서 click 도 듣는다(loadingVideo playMusic 과 같게)
    window.addEventListener("pointerdown", sync, { capture: true });
    window.addEventListener("click", sync, { capture: true });
    window.addEventListener("keydown", sync, { capture: true });
    return () => {
      window.clearInterval(syncTimer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointerdown", sync, { capture: true });
      window.removeEventListener("click", sync, { capture: true });
      window.removeEventListener("keydown", sync, { capture: true });
      cancelAnimationFrame(raf);
      // 줄이며 끈다 — 타이머로(숨긴 탭에서도 끝난다), 줄이는 사이 탭을 숨기면 바로 멈춘다(Codex 리뷰)
      const from = audio.volume;
      const outAt = performance.now();
      const stop = () => {
        window.clearInterval(fadeTimer);
        document.removeEventListener("visibilitychange", stopIfHidden);
        audio.pause();
      };
      const stopIfHidden = () => {
        if (document.hidden) stop();
      };
      const fadeTimer = window.setInterval(() => {
        const t = Math.min(1, (performance.now() - outAt) / 1500);
        audio.volume = from * (1 - t);
        if (t >= 1) stop();
      }, 50);
      document.addEventListener("visibilitychange", stopIfHidden);
      if (document.hidden) stop();
    };
  }, []);
}

// ── 클리어 화면 + 현장 방문 창 ──

type Busy = { id: string; text: string } | null;
type Failure = { message: string; retry?: { label: string; run: () => void } } | null;

function ClearScreen({ leaveAction }: EndingLayerProps) {
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [isConfirmingRestart, setIsConfirmingRestart] = useState(false);
  const isSaving = isGameSaveEnabled();
  const playTime = formatPlayTime(playClock.elapsed());

  // 기차 · 로비로 간 뒤 브라우저 「뒤로」로 이 페이지가 캐시에서 되살아나면 단추를 다시 쓸 수 있게(PauseMenu 와 같게, Codex 리뷰)
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setBusy(null);
      setFailure(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // 클리어 화면에서도 게임 키가 뒤로 새지 않게 — 전파만 끊고 기본 동작은 둔다(Tab 이동 · Space/Enter 로 단추 누르기는 된다,
  // Space 가 걷기 훅까지 가면 점프가 쌓이고 단추도 안 눌렸다 — Codex 리뷰). Esc 는 다시 묻기만 닫는다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && isConfirmingRestart) setIsConfirmingRestart(false);
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isConfirmingRestart]);

  const go = async (id: string, text: string, leave: (force: boolean) => Promise<LeaveResult>, force = false) => {
    setBusy({ id, text });
    setFailure(null);
    const result = await leave(force);
    if (result === "left") return;
    setBusy(null);
    setFailure({
      message: "저장하지 못했어요. 연결을 확인하고 다시 해 보거나, 저장 없이 갈 수 있어요.",
      retry: { label: "그래도 가기", run: () => void go(id, text, leave, true) },
    });
  };

  const restart = async () => {
    setBusy({ id: "restart", text: isSaving ? "기록을 지우는 중…" : "처음으로 돌아가는 중…" });
    setFailure(null);
    if (await restartNajuCase()) return;
    setBusy(null);
    setFailure({ message: RESTART_FAILED_TEXT });
  };

  return (
    <div className="naju-ending-clear" data-hud="클리어 화면">
      <div className="naju-ending-clear__inner">
        <section className="naju-ending-clear__result">
          <div className="naju-ending-clear__eyebrow">{CLEAR_TEXT.eyebrow}</div>
          <h1 className="naju-ending-clear__title">{CLEAR_TEXT.title}</h1>
          <p className="naju-ending-clear__line">{CLEAR_TEXT.line}</p>
          <div className="naju-ending-clear__time">
            <span>조사 시간</span>
            <b>{playTime}</b>
          </div>
          <div className="naju-ending-clear__actions">
            {leaveAction && (
              <>
                <button
                  type="button"
                  className="naju-ending-btn naju-ending-btn--primary"
                  disabled={busy !== null}
                  onClick={() =>
                    void go("train", isSaving ? "저장하고 기차로 가는 중…" : "기차로 가는 중…", leaveToTrain)
                  }
                >
                  {busy?.id === "train" ? busy.text : CLEAR_TEXT.train}
                  <small>{CLEAR_TEXT.trainNote}</small>
                </button>
                <button
                  type="button"
                  className="naju-ending-btn"
                  disabled={busy !== null}
                  onClick={() =>
                    void go("lobby", isSaving ? "저장하고 로비로 가는 중…" : "로비로 가는 중…", (force) =>
                      leaveAction.leave(force),
                    )
                  }
                >
                  {busy?.id === "lobby" ? busy.text : CLEAR_TEXT.lobby}
                </button>
              </>
            )}
            {isConfirmingRestart ? (
              <div className="naju-ending-clear__confirm" role="alertdialog" aria-label={CLEAR_TEXT.restartQuestion}>
                <p>{CLEAR_TEXT.restartQuestion}</p>
                <small>{isSaving ? CLEAR_TEXT.restartNote : CLEAR_TEXT.restartNoteGuest}</small>
                <div>
                  <button
                    type="button"
                    className="naju-ending-btn naju-ending-btn--quiet"
                    disabled={busy !== null}
                    onClick={() => setIsConfirmingRestart(false)}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="naju-ending-btn naju-ending-btn--danger"
                    disabled={busy !== null}
                    onClick={() => void restart()}
                  >
                    {busy?.id === "restart" ? busy.text : CLEAR_TEXT.restartConfirm}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="naju-ending-btn naju-ending-btn--quiet"
                disabled={busy !== null}
                onClick={() => setIsConfirmingRestart(true)}
              >
                {CLEAR_TEXT.restart}
              </button>
            )}
            {failure && (
              <div className="naju-ending-clear__failure" role="alert">
                {failure.message}
                {failure.retry && (
                  <button type="button" className="naju-ending-link" onClick={failure.retry.run}>
                    {failure.retry.label}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="naju-ending-clear__links">
            <button type="button" className="naju-ending-link" disabled={busy !== null} onClick={ending.openFilm}>
              엔딩 다시 보기
            </button>
            <span aria-hidden>·</span>
            <button type="button" className="naju-ending-link" disabled={busy !== null} onClick={ending.close}>
              새벽의 강가 둘러보기
            </button>
          </div>
        </section>
        <VisitPanel />
      </div>
    </div>
  );
}

/** 현장 방문 · 방문 보상 창 — 황포돛배 선착장에서 방문 인증 → 추가 스토리 · 방문 보상 */
function VisitPanel() {
  return (
    <aside className="naju-ending-visit" aria-label={VISIT_TEXT.title}>
      <div className="naju-ending-visit__badge">{VISIT_TEXT.badge}</div>
      <h2 className="naju-ending-visit__title">{VISIT_TEXT.title}</h2>
      <p className="naju-ending-visit__lead">{VISIT_TEXT.lead}</p>
      <dl className="naju-ending-visit__rows">
        <dt>장소</dt>
        <dd>
          <b>{VISIT_TEXT.place}</b>
          <span>{VISIT_TEXT.spot}</span>
        </dd>
        <dt>하는 법</dt>
        <dd>{VISIT_TEXT.how}</dd>
        <dt>받는 것</dt>
        <dd>
          <ul>
            {VISIT_TEXT.rewards.map((reward) => (
              <li key={reward}>{reward}</li>
            ))}
          </ul>
        </dd>
      </dl>
      <p className="naju-ending-visit__note">{VISIT_TEXT.note}</p>
    </aside>
  );
}
