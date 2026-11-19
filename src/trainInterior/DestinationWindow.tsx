import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { najuCaseProgress, pendingNajuReset, resetNajuCase, type CaseProgress } from "@/naju";
import { readSavedSection } from "@/save/gameSave";
import { NAJU_ENTER_EVENT, type NajuEnterDetail } from "@/station/najuEnter";

import {
  DESTINATIONS,
  LOCKED_LEGENDS,
  NAJU_LEGEND,
  type Destination,
  type Difficulty,
  type LockedLegend,
} from "./destinationData";
import DestinationMap, { LOCK_LINE_PATH } from "./DestinationMap";
import "./destinationWindow.css";

const SHAKE_MS = 360;

/** 커서 자리를 CSS 값으로 넘긴다. 카드 기울기·빛 번짐은 전부 CSS 가 이 값을 읽어 그린다. */
function trackPointer(event: ReactPointerEvent<HTMLElement>) {
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  element.style.setProperty("--pointer-x", `${x * 100}%`);
  element.style.setProperty("--pointer-y", `${y * 100}%`);
  element.style.setProperty("--tilt-x", `${(0.5 - y) * 7}deg`);
  element.style.setProperty("--tilt-y", `${(x - 0.5) * 9}deg`);
}

function resetPointer(event: ReactPointerEvent<HTMLElement>) {
  const { style } = event.currentTarget;
  style.setProperty("--tilt-x", "0deg");
  style.setProperty("--tilt-y", "0deg");
}

/** 난이도 글자 — 쉬움 · 보통 · 어려움(destinationData) */
function DifficultyTag({ level }: { level: Difficulty }) {
  return (
    <span className="dest-difficulty" data-level={level}>
      <span className="dest-difficulty__label">난이도</span>
      <b>{level}</b>
    </span>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={LOCK_LINE_PATH} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Chevron({ direction }: { direction: -1 | 1 }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction < 0 ? "M15 4 7 12l8 8" : "M9 4l8 8-8 8"} />
    </svg>
  );
}

/** 커서가 올라간 버튼을 [E] 로 누를 수 있다는 표시. :hover 일 때만 보인다. */
const KeyHint = () => <span className="dest-key">E</span>;

/** 하던 케이스의 진행 — 「진행 중 32%」 · 「완료」 */
const progressText = (progress: CaseProgress) => (progress.isCleared ? "완료" : `진행 중 ${progress.percent}%`);

interface RegionRowProps {
  destination: Destination;
  isLinked: boolean;
  order: number;
  /** 이 지역에서 하던 케이스의 진행(없으면 처음) */
  progress: CaseProgress | null;
  onLink: (id: string | null) => void;
  onPress: () => void;
}

function RegionRow({ destination, isLinked, order, progress, onLink, onPress }: RegionRowProps) {
  const { id, name, roman, photo, isOpen } = destination;
  return (
    <button
      type="button"
      data-dest-button
      data-dest-id={id}
      className={`dest-row${isOpen ? " is-open" : ""}${isLinked ? " is-linked" : ""}`}
      style={{ animationDelay: `${0.12 + order * 0.06}s` }}
      onClick={onPress}
      onPointerEnter={() => onLink(id)}
      onPointerLeave={() => onLink(null)}
    >
      <span className="dest-row__thumb">
        {photo && <img src={photo} alt="" />}
        {!isOpen && <LockIcon className="dest-row__lock" />}
      </span>
      <span className="dest-row__name">
        {name}
        <span className="dest-row__roman">{roman}</span>
      </span>
      {isOpen && progress && (
        <span className={`dest-row__progress${progress.isCleared ? " is-cleared" : ""}`}>{progressText(progress)}</span>
      )}
      {isOpen ? (
        <span className="dest-row__go">{progress && !progress.isCleared ? "이어서 ›" : "입장 가능 ›"}</span>
      ) : (
        <span className="dest-chip">출시 예정</span>
      )}
      <KeyHint />
    </button>
  );
}

function LockedLegendCard({
  legend,
  side,
  onPress,
}: {
  legend: LockedLegend;
  side: "left" | "right";
  onPress: (target: HTMLElement) => void;
}) {
  return (
    <div className={`dest-slot dest-slot--${side}`}>
      <button
        type="button"
        data-dest-button
        className="dest-card dest-card--side"
        aria-label={`${legend.name} 잠김`}
        onClick={(event) => onPress(event.currentTarget)}
        onPointerMove={trackPointer}
        onPointerLeave={resetPointer}
      >
        <img key={legend.id} className="dest-card__photo dest-swap" src={legend.photo} alt="" />
        <span className="dest-card__fade" />
        <span className="dest-card__sheen" />
        <LockIcon className="dest-card__lock" />
        <span key={`${legend.id}-text`} className="dest-card__text dest-swap">
          <span className="dest-card__meta">
            <span className="dest-card__label">SCENARIO</span>
            <span className="dest-chip">출시 예정</span>
          </span>
          <span className="dest-card__title">{legend.name}</span>
          <span className="dest-card__kind">{NAJU_LEGEND.region}</span>
        </span>
      </button>
    </div>
  );
}

function OpenLegendCard({ progress }: { progress: CaseProgress | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div className="dest-slot dest-slot--center">
      <div
        className="dest-card dest-card--center"
        onPointerMove={trackPointer}
        onPointerEnter={() => void videoRef.current?.play().catch(() => undefined)}
        onPointerLeave={(event) => {
          resetPointer(event);
          videoRef.current?.pause();
        }}
      >
        <img className="dest-card__photo" src={NAJU_LEGEND.photo} alt="" />
        <video
          ref={videoRef}
          className="dest-card__video"
          src={NAJU_LEGEND.video}
          muted
          loop
          playsInline
          preload="none"
        />
        <span className="dest-card__scan" />
        <span className="dest-card__fade" />
        <span className="dest-card__sheen" />
        <span className="dest-card__top">
          <DifficultyTag level={NAJU_LEGEND.difficulty} />
        </span>
        <span className="dest-card__text">
          <span className="dest-card__meta">
            <span className="dest-card__label">SCENARIO</span>
            <span className="dest-region-tag">
              <span>지역</span>
              <b>{NAJU_LEGEND.region}</b>
            </span>
          </span>
          <span className="dest-card__title">{NAJU_LEGEND.name}</span>
          <span className="dest-card__kind">1인칭 추리</span>
          {/* 하던 케이스 — 어디까지 했는지(미르 11/10). 처음이면 그리지 않는다 */}
          {progress && (
            <span
              className={`dest-card__progress${progress.isCleared ? " is-cleared" : ""}`}
              data-testid="case-progress"
            >
              <span className="dest-card__progress-label">
                {progress.isCleared ? "완료한 전설" : `진행 중 · ${progress.stageName}`}
                <b>{progress.percent}%</b>
              </span>
              <span className="dest-card__progress-bar" aria-hidden="true">
                <i style={{ width: `${progress.percent}%` }} />
              </span>
            </span>
          )}
          <span className="dest-card__description">{NAJU_LEGEND.description}</span>
        </span>
      </div>
    </div>
  );
}

function ArrowButton({ direction, onPress }: { direction: -1 | 1; onPress: () => void }) {
  return (
    <button
      type="button"
      data-dest-button
      className={`dest-arrow dest-arrow--${direction < 0 ? "prev" : "next"}`}
      aria-label={direction < 0 ? "이전 전설" : "다음 전설"}
      onClick={onPress}
    >
      <Chevron direction={direction} />
      <KeyHint />
    </button>
  );
}

const STEP_TEXT = {
  region: { title: "지역 선택", subtitle: "전설이 잠들어 있는 땅을 고르세요" },
  legend: { title: "나주의 전설", subtitle: "어떤 이야기 속으로 들어가시겠습니까?" },
} as const;

/**
 * 객차 안내판에서 여는 목적지 창. 지역 → 전설 순서로 고른다.
 * 크기를 전부 창 폭에 묶어 어느 화면에서도 스크롤 없이 한 장에 들어온다.
 * 마우스 잠금이 풀린 채 열려 커서로 누르고, 커서가 올라간 버튼은 [E] 로도 눌린다.
 */
function DestinationContent({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<keyof typeof STEP_TEXT>("region");
  // 나주에서 하던 진행 — 창을 열 때 저장본에서 한 번 센다(나주는 다른 페이지라 이 페이지에서는 바뀌지 않는다)
  const [najuProgress, setNajuProgress] = useState(() => najuCaseProgress((name) => readSavedSection(name)));
  /** 진행을 저장본에서 다시 센다 — 처음부터 다시가 끝났거나(지워짐) 실패했을 때(되돌려짐) */
  const recountProgress = () => setNajuProgress(najuCaseProgress((name) => readSavedSection(name)));
  const [lockedPage, setLockedPage] = useState(0);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  // 창이 열리면 마우스 잠금이 풀려 App 의 E 까지 가지 않으므로 창이 직접 듣는다.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyE" || event.repeat) return;
      const hovered = windowRef.current?.querySelector<HTMLElement | SVGElement>("[data-dest-button]:hover");
      hovered?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const shake = (element: Element | null | undefined) => {
    playSound("locked");
    element?.classList.add("is-shaking");
    setTimeout(() => element?.classList.remove("is-shaking"), SHAKE_MS);
  };

  const pressDestination = (destination: Destination) => {
    if (!destination.isOpen) {
      shake(windowRef.current?.querySelector(`[data-dest-id="${destination.id}"]`));
      return;
    }
    playSound("button");
    setLinkedId(null);
    setStep("legend");
  };

  const turnPage = (delta: number) => {
    playSound("button");
    setLockedPage((page) => (page + delta + LOCKED_LEGENDS.length) % LOCKED_LEGENDS.length);
  };

  /**
   * 처음부터 다시(미르 11/10) — 한 번 더 묻는다(지우면 되돌릴 수 없다). 나주 진행을 지우고 저장까지 마친 뒤에 들어간다.
   * 못 지웠으면 들어가지 않는다 — 나주가 옛 저장을 그대로 읽어 「처음부터」가 아니게 된다
   */
  // 앞서 연 창에서 시작한 처음부터 다시가 아직 끝나지 않았으면 그것부터 기다린다(끝나기 전에는 들어가지 못한다)
  const [restartPhase, setRestartPhase] = useState<"idle" | "asking" | "working" | "failed">(() =>
    pendingNajuReset() ? "working" : "idle",
  );
  // 지우는 사이 창이 닫혔으면(ESC 등) 끝난 뒤에 나주로 넘기지 않는다 — 게임으로 돌아간 사람을 순간이동시키지 않게(Codex 리뷰)
  const isOpenRef = useRef(true);
  useEffect(() => {
    // 개발 모드(StrictMode)는 붙였다 떼었다 다시 붙인다 — 다시 붙을 때 켜 둔다
    isOpenRef.current = true;
    // 앞 창의 처음부터 다시가 끝나면 — 들어가지는 않고(그 창은 닫혔다) 결과만 보인다
    void pendingNajuReset()?.then((isReset) => {
      if (!isOpenRef.current) return;
      recountProgress();
      setRestartPhase(isReset ? "idle" : "failed");
    });
    return () => {
      isOpenRef.current = false;
    };
  }, []);
  const restart = async () => {
    playSound("button");
    setRestartPhase("working");
    const isReset = await resetNajuCase();
    if (!isOpenRef.current) return;
    if (!isReset) {
      recountProgress();
      setRestartPhase("failed");
      return;
    }
    enterLegend();
  };
  /** 지우는 동안은 닫기 · 뒤로를 받지 않는다 */
  const isRestarting = restartPhase === "working";

  const enterLegend = () => {
    playSound("button");
    exposeDevHook("destinationSelect", "naju");
    // 아바타 종류(사이드킥)만 이어서 넘긴다 — naju 기본은 Meshy 캐릭터.
    const avatar = new URLSearchParams(location.search).get("avatar");
    const query = avatar === "sidekick" ? "?avatar=sidekick" : "";
    window.dispatchEvent(new CustomEvent<NajuEnterDetail>(NAJU_ENTER_EVENT, { detail: { query } }));
  };

  const leftLegend = LOCKED_LEGENDS[lockedPage];
  const rightLegend = LOCKED_LEGENDS[(lockedPage + 1) % LOCKED_LEGENDS.length];
  const text = STEP_TEXT[step];

  return (
    <div className="dest-backdrop">
      <div
        ref={windowRef}
        className="dest-window"
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        onPointerMove={trackPointer}
      >
        <div className={`dest-stage dest-stage--${step}`}>
          <div className="dest-glow" />
          {step === "legend" && <img className="dest-ambient" src={NAJU_LEGEND.photo} alt="" />}

          <header className="dest-header">
            {step === "legend" && (
              <button
                type="button"
                data-dest-button
                className="dest-round"
                aria-label="뒤로 가기"
                disabled={isRestarting}
                onClick={() => {
                  playSound("button");
                  setStep("region");
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 12H5M11 5l-7 7 7 7" />
                </svg>
                <KeyHint />
              </button>
            )}
            <div key={step} className="dest-heading">
              <span className="dest-badge">DESTINATIONS</span>
              <h2 className="dest-title">{text.title}</h2>
              <p className="dest-subtitle">{text.subtitle}</p>
            </div>
          </header>

          <div className="dest-progress" aria-hidden="true">
            <span className={step === "region" ? "is-current" : "is-done"}>01 지역</span>
            <i className={step === "legend" ? "is-done" : ""} />
            <span className={step === "legend" ? "is-current" : ""}>02 전설</span>
          </div>
          <button
            type="button"
            data-dest-button
            className="dest-round dest-close"
            aria-label="닫기"
            disabled={isRestarting}
            onClick={onClose}
          >
            ×
            <KeyHint />
          </button>

          {step === "region" ? (
            <div key="region" className="dest-step">
              <DestinationMap linkedId={linkedId} onLink={setLinkedId} onPress={pressDestination} />
              <div className="dest-list">
                {DESTINATIONS.map((destination, order) => (
                  <RegionRow
                    key={destination.id}
                    destination={destination}
                    isLinked={linkedId === destination.id}
                    order={order}
                    progress={destination.id === "naju" ? najuProgress : null}
                    onLink={setLinkedId}
                    onPress={() => pressDestination(destination)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div key="legend" className="dest-step">
              <ArrowButton direction={-1} onPress={() => turnPage(-1)} />
              <LockedLegendCard legend={leftLegend} side="left" onPress={shake} />
              <OpenLegendCard progress={najuProgress} />
              <LockedLegendCard legend={rightLegend} side="right" onPress={shake} />
              <ArrowButton direction={1} onPress={() => turnPage(1)} />
              {/* 처음부터 다시를 묻는 동안은 입장 단추를 내린다(그 자리에 확인 창이 뜬다) */}
              {restartPhase === "idle" && (
                <button type="button" data-dest-button className="dest-enter" onClick={enterLegend}>
                  {/* 하던 케이스면 이어서 — 나주는 저장된 데서 다시 시작한다 */}
                  <span>{najuProgress && !najuProgress.isCleared ? "이어서 하기" : "전설 속으로"}</span>
                  <KeyHint />
                </button>
              )}
              {/* 하던 · 끝낸 케이스 — 처음부터 다시 */}
              {najuProgress && restartPhase === "idle" && (
                <button
                  type="button"
                  data-dest-button
                  className="dest-restart"
                  data-testid="case-restart"
                  onClick={() => {
                    playSound("button");
                    setRestartPhase("asking");
                  }}
                >
                  처음부터 다시
                  <KeyHint />
                </button>
              )}
              {/* 묻기 · 지우는 중 · 실패는 진행률과 따로 — 앞 창에서 시작한 것을 이어받으면 진행률이 잠깐 비어 있다 */}
              {restartPhase !== "idle" && (
                <div
                  className="dest-restart-ask"
                  role="alertdialog"
                  aria-label="처음부터 다시"
                  data-testid="case-restart-ask"
                >
                  <p className="dest-restart-ask__title">
                    {restartPhase === "failed"
                      ? "지우지 못했어요. 연결을 확인하고 다시 해 주세요."
                      : restartPhase === "working"
                        ? "지우는 중…"
                        : "처음부터 다시 할까요?"}
                  </p>
                  {restartPhase === "asking" && (
                    <p className="dest-restart-ask__note">
                      앙암바위에서 한 진행(푼 퍼즐 · 소지품 · 위치)이 모두 지워지고 되돌릴 수 없어요.
                    </p>
                  )}
                  {restartPhase !== "working" && (
                    <div className="dest-restart-ask__row">
                      <button
                        type="button"
                        data-dest-button
                        className="dest-restart-ask__confirm"
                        data-testid="case-restart-confirm"
                        onClick={() => void restart()}
                      >
                        {restartPhase === "failed" ? "다시 해 보기" : "처음부터 시작"}
                        <KeyHint />
                      </button>
                      <button
                        type="button"
                        data-dest-button
                        className="dest-restart-ask__cancel"
                        onClick={() => {
                          playSound("button");
                          setRestartPhase("idle");
                        }}
                      >
                        취소
                        <KeyHint />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DestinationWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 닫으면 내용을 내려 다음에 열 때 지역 선택부터 시작한다.
  return open ? <DestinationContent onClose={onClose} /> : null;
}
