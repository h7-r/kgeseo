/**
 * 캔버스 밖: 상황실 긴급 호출 카드와, 카드를 닫은 뒤 남는 임무 목표.
 * 카드는 [E]·Enter·클릭으로 닫거나 16초 뒤 저절로 접힌다. 기차에 오르면 둘 다 사라진다.
 */
import { useEffect, useRef, type CSSProperties } from "react";

import { acknowledgeDispatch, DISPATCH_COLOR, tickDispatch, useDispatchState } from "./dispatchState";

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
        <div style={dispatchCardStyle}>
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
          바닥의 주황 화살표를 따라 기차 오른쪽 문으로 오르세요
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
  display: "grid",
  placeItems: "center",
  padding: 16,
  background: "radial-gradient(ellipse at center, rgba(40,10,0,.35), rgba(0,0,0,.6))",
  zIndex: 40,
  animation: "dispatch-fade-in .45s ease-out",
};

const dispatchCardStyle: CSSProperties = {
  width: "min(520px, 100%)",
  padding: "20px 24px 16px",
  borderRadius: 12,
  background: "rgba(14, 12, 12, 0.92)",
  border: `1px solid ${DISPATCH_COLOR}66`,
  boxShadow: `0 0 0 1px rgba(0,0,0,.4), 0 0 40px ${DISPATCH_COLOR}22, 0 18px 40px rgba(0,0,0,.5)`,
  color: "#f1ece6",
  lineHeight: 1.6,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  letterSpacing: "0.12em",
  color: DISPATCH_COLOR,
  marginBottom: 10,
};

const sirenDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 99,
  background: "#ff4d3d",
  boxShadow: "0 0 10px #ff4d3d",
  animation: "dispatch-blink 1s steps(2, start) infinite",
};

const titleStyle: CSSProperties = {
  margin: "0 0 12px",
  fontSize: 24,
  fontWeight: 800,
  letterSpacing: "-0.01em",
};
const bodyStyle: CSSProperties = { fontSize: 15, color: "#d8d0c8" };
const paragraphStyle: CSSProperties = { margin: "0 0 6px" };
const commandLineStyle: CSSProperties = {
  ...paragraphStyle,
  color: "#fff",
  fontWeight: 700,
  marginTop: 10,
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 14,
  fontSize: 12,
  color: "#a0968c",
};

const keyCapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 24,
  height: 24,
  marginRight: 6,
  borderRadius: 5,
  background: "linear-gradient(#f4f6f8, #cfd6dd)",
  color: "#1b2229",
  fontWeight: 700,
  fontSize: 12,
  boxShadow: "0 2px 0 #7f8a95",
};

const objectiveStyle: CSSProperties = {
  position: "fixed",
  top: "max(18px, env(safe-area-inset-top, 0px))",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(460px, calc(100vw - 32px))",
  padding: "10px 16px",
  borderRadius: 10,
  background: "rgba(14, 12, 12, 0.8)",
  borderLeft: `3px solid ${DISPATCH_COLOR}`,
  color: "#f1ece6",
  pointerEvents: "none",
  zIndex: 20,
};

const objectiveHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 11,
  letterSpacing: "0.1em",
  color: DISPATCH_COLOR,
};
const objectiveDotStyle: CSSProperties = { width: 6, height: 6, borderRadius: 99, background: DISPATCH_COLOR };
const objectiveTextStyle: CSSProperties = { fontSize: 14, marginTop: 3 };
const distanceStyle: CSSProperties = { color: "#a0968c" };

// 키프레임은 인라인 스타일로 못 적어 한 번만 문서에 붙인다
if (typeof document !== "undefined" && !document.getElementById("dispatch-keyframes")) {
  const style = document.createElement("style");
  style.id = "dispatch-keyframes";
  style.textContent = `
@keyframes dispatch-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes dispatch-blink { to { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { [role="alertdialog"] { animation: none !important; } }`;
  document.head.appendChild(style);
}
