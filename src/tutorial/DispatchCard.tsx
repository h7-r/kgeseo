/**
 * 캔버스 밖: 상황실 긴급 호출 카드와, 카드를 닫은 뒤 남는 임무 목표.
 * 카드는 [E]·Enter·클릭으로 닫거나 16초 뒤 저절로 접힌다. 기차에 오르면 둘 다 사라진다.
 */
import { useEffect, useRef, type CSSProperties } from "react";

import { PANEL_SHADOW, UI, UI_FONT, keyCapStyle } from "@/game/gameUi";
import { isTypingTarget } from "@/game/overlayLayer";

import "@/game/gameUi.css";

import { acknowledgeDispatch, tickDispatch, useDispatchState } from "./dispatchState";

/** 무전 수신음을 WebAudio 로 짧게 만든다(파일 없음). 브라우저가 막으면 조용히 넘어간다. */
function playRadioChirp() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const now = context.currentTime;
    const beep = (at: number, frequency: number, length: number, volume: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(volume, now + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + at);
      oscillator.stop(now + at + length + 0.02);
    };
    beep(0, 880, 0.12, 0.05);
    beep(0.18, 880, 0.12, 0.05);
    beep(0.36, 1320, 0.22, 0.05);
    setTimeout(() => context.close(), 1200);
  } catch {
    // 소리는 덤이다 — 실패해도 안내는 그대로
  }
}

interface DispatchCardProps {
  /** 다른 창이 열려 있다 */
  covered?: boolean;
  isInTrain?: boolean;
}

export default function DispatchCard({ covered = false, isInTrain = false }: DispatchCardProps) {
  const { phase, doorDistance } = useDispatchState();
  const hasChirped = useRef(false);

  // 기차 씬에서는 본부실 캔버스가 안 돌 수 있어 여기서도 탑승을 알린다
  useEffect(() => {
    if (isInTrain) tickDispatch({ isInHeadquarters: false, isInTrain: true });
  }, [isInTrain]);

  useEffect(() => {
    if (phase !== "alert") return undefined;
    if (!hasChirped.current) {
      hasChirped.current = true;
      playRadioChirp();
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      // 입력칸(로비 채팅)에서 친 E·Enter 는 출동 확인이 아니다
      if (isTypingTarget(event.target)) return;
      if (event.code === "KeyE" || event.code === "Enter") acknowledgeDispatch();
    };
    window.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(acknowledgeDispatch, 16000);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [phase]);

  if (covered || isInTrain) return null;

  if (phase === "alert")
    return (
      <div style={overlayStyle} onClick={acknowledgeDispatch} role="alertdialog" aria-labelledby="dispatch-title">
        <div className="game-panel" style={dispatchCardStyle}>
          <div style={headerStyle}>
            <span style={sirenDotStyle} />
            긴급 호출 · 수사본부 상황실
          </div>
          <h2 id="dispatch-title" style={titleStyle}>
            나주 앙암바위, 왜곡 발생
          </h2>
          <div style={bodyStyle}>
            <p style={paragraphStyle}>영산강 앙암바위 일대의 시공간이 비틀리기 시작했다.</p>
            <p style={paragraphStyle}>강물 위로 지워졌던 옛 장면이 겹쳐 떠오르고, 왜곡은 지금도 번지는 중이다.</p>
            <p style={commandLineStyle}>더 퍼지기 전에 막아야 한다. 즉시 기차에 올라 나주로 출동하라.</p>
          </div>
          <div style={footerStyle}>
            <span>— 상황실</span>
            <span>
              <kbd style={keyCapStyle}>E</kbd> 출동
            </span>
          </div>
        </div>
      </div>
    );

  if (phase === "guide")
    return (
      <div style={objectiveStyle} role="status">
        <div style={objectiveHeaderStyle}>
          <span style={objectiveDotStyle} />
          임무 · 나주 앙암바위 왜곡 저지
        </div>
        <div style={objectiveTextStyle}>
          바닥의 화살표를 따라 기차 오른쪽 문으로 오르세요
          {doorDistance != null && (
            <span style={distanceStyle}>
              {doorDistance <= 1 ? " · 기차 문 바로 앞" : ` · 기차 문까지 ${doorDistance}m`}
            </span>
          )}
        </div>
      </div>
    );

  return null;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 45,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "rgba(1,4,10,.62)",
};

const dispatchCardStyle: CSSProperties = {
  width: "min(620px, 100%)",
  boxSizing: "border-box",
  padding: "30px 34px 24px",
  borderRadius: 16,
  background: UI.surface,
  border: `1px solid ${UI.borderStrong}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  font: `400 15px/1.75 ${UI_FONT.body}`,
  cursor: "pointer",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  color: UI.danger,
  font: `600 13px/1 ${UI_FONT.body}`,
};

const sirenDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 4,
  background: UI.danger,
  animation: "dispatch-blink 1s steps(2, start) infinite",
};

const titleStyle: CSSProperties = { margin: "14px 0 14px", font: `700 30px/1.25 ${UI_FONT.title}`, color: UI.text };
const bodyStyle: CSSProperties = { color: UI.textMuted };
const paragraphStyle: CSSProperties = { margin: "0 0 4px" };
const commandLineStyle: CSSProperties = { margin: "12px 0 0", color: UI.text, fontWeight: 600 };

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 22,
  paddingTop: 16,
  borderTop: `1px solid ${UI.border}`,
  color: UI.textMuted,
  fontSize: 13,
};

const objectiveStyle: CSSProperties = {
  position: "fixed",
  top: "max(16px, env(safe-area-inset-top, 0px))",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(520px, calc(100vw - 32px))",
  boxSizing: "border-box",
  padding: "14px 20px",
  borderRadius: 16,
  background: UI.glass,
  border: `1px solid ${UI.border}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  font: `400 14px/1.55 ${UI_FONT.body}`,
  pointerEvents: "none",
  zIndex: 20,
};

const objectiveHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 4,
  color: UI.accent,
  font: `600 13px/1.2 ${UI_FONT.body}`,
};

const objectiveDotStyle: CSSProperties = { width: 7, height: 7, borderRadius: 4, background: UI.accent };
const objectiveTextStyle: CSSProperties = { color: UI.text };
const distanceStyle: CSSProperties = { color: UI.textMuted, fontVariantNumeric: "tabular-nums" };
