import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { playSound } from "@/audio/sound";
import { exposeDevHook } from "@/debug/devHooks";
import { NAJU_ENTER_EVENT, type NajuEnterDetail } from "@/station/najuEnter";

import { DESTINATIONS, LOCKED_LEGENDS, NAJU_LEGEND, type Destination, type LockedLegend } from "./destinationData";
import DestinationMap, { LOCK_LINE_PATH } from "./DestinationMap";
import "./destinationWindow.css";

const STAR_COUNT = 5;
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

function Stars({ filled }: { filled: number }) {
  return (
    <span className="dest-stars" aria-label={`난이도 ${STAR_COUNT}점 중 ${filled}점`}>
      {"★".repeat(filled)}
      <span className="dest-stars__empty">{"★".repeat(STAR_COUNT - filled)}</span>
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

interface RegionRowProps {
  destination: Destination;
  isLinked: boolean;
  order: number;
  onLink: (id: string | null) => void;
  onPress: () => void;
}

function RegionRow({ destination, isLinked, order, onLink, onPress }: RegionRowProps) {
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
      {isOpen ? <span className="dest-row__go">입장 가능 ›</span> : <span className="dest-chip">출시 예정</span>}
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

function OpenLegendCard() {
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
          <Stars filled={NAJU_LEGEND.stars} />
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
          <button type="button" data-dest-button className="dest-round dest-close" aria-label="닫기" onClick={onClose}>
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
              <OpenLegendCard />
              <LockedLegendCard legend={rightLegend} side="right" onPress={shake} />
              <ArrowButton direction={1} onPress={() => turnPage(1)} />
              <button type="button" data-dest-button className="dest-enter" onClick={enterLegend}>
                <span>전설 속으로</span>
                <KeyHint />
              </button>
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
