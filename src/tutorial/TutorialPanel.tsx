/**
 * 캔버스 밖: 지금 단계의 안내판(키 칩 + 한두 줄 설명). 화면 위 가운데 — 조준점·힌트 표시·[V] 버튼과 안 겹친다.
 * 넘어갈 때 방금 끝낸 단계를 「✓」로 잠깐 보여 줘 눌러 봤더니 됐다는 걸 알게 한다. [F1] 로 숨긴다.
 */
import { useEffect, useState, type CSSProperties } from "react";

import { useDispatchState } from "./dispatch";
import { TUTORIAL_STEPS, toggleTutorialHidden, useTutorial } from "./tutorial";

const PUZZLE_COUNT = TUTORIAL_STEPS.filter((step) => step.puzzle).length;
const CONTROL_STEP_COUNT = TUTORIAL_STEPS.findIndex((step) => step.puzzle);

interface Flash {
  step: number;
  title: string;
}

interface TutorialPanelProps {
  /** 창(힌트함·자물쇠 조작 등)이 열려 있다 — 숨는다 */
  covered?: boolean;
}

export default function TutorialPanel({ covered = false }: TutorialPanelProps) {
  const { step, previousStepId, isFinished, isHidden } = useTutorial();
  const { phase: dispatchPhase } = useDispatchState();
  const current = TUTORIAL_STEPS[step];
  const [isFinishedHidden, setIsFinishedHidden] = useState(false);

  // 단계가 넘어가면 1.1초 동안 「✓ 방금 한 것」
  const flashFor = (stepIndex: number): Flash | null =>
    previousStepId
      ? {
          step: stepIndex,
          title: TUTORIAL_STEPS.find((s) => s.id === previousStepId)?.title ?? "",
        }
      : null;
  const [flash, setFlash] = useState<Flash | null>(() => flashFor(step));
  const [seenStep, setSeenStep] = useState(step);
  if (step !== seenStep) {
    setSeenStep(step);
    if (previousStepId) setFlash(flashFor(step));
  }
  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(timer);
  }, [flash]);

  // 다 끝나면 완료 문구가 「H 로 확인」을 시키므로 힌트함을 한 번 열면 접는다. 안 열어도 40초 뒤 접는다.
  useEffect(() => {
    if (!isFinished) return undefined;
    const timer = setTimeout(() => setIsFinishedHidden(true), 40000);
    return () => clearTimeout(timer);
  }, [isFinished]);
  if (isFinished && covered && !isFinishedHidden) setIsFinishedHidden(true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "F1") {
        event.preventDefault();
        toggleTutorialHidden();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 출동 호출 카드가 같은 위쪽 가운데에 뜨므로 자리를 내준다
  const isDispatching = dispatchPhase === "alert" || dispatchPhase === "guide" || dispatchPhase === "boarded";
  if (!current || covered || isDispatching || (isFinished && isFinishedHidden)) return null;
  if (isHidden) return <div style={collapsedStyle}>[F1] 안내 보기</div>;

  const heading = current.puzzle
    ? `퍼즐 ${current.puzzle} / ${PUZZLE_COUNT}`
    : step < CONTROL_STEP_COUNT
      ? `조작 익히기 ${step + 1} / ${CONTROL_STEP_COUNT}`
      : null;

  return (
    <div style={panelStyle} role="status" aria-live="polite">
      {flash && <div style={flashStyle}>✓ {flash.title}</div>}
      <div style={headerStyle}>
        {heading && <span style={current.puzzle ? puzzleBadgeStyle : stepBadgeStyle}>{heading}</span>}
        <span style={titleStyle}>{current.title}</span>
      </div>
      <div style={textStyle}>
        {current.text.split("\n").map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      {current.keys.length > 0 && (
        <div style={keyListStyle}>
          {current.keys.map(([keys, description], i) => (
            <div key={i} style={keyRowStyle}>
              <span style={chipGroupStyle}>
                {keys.map((key) => (
                  <kbd key={key} style={key.length > 2 ? wideChipStyle : chipStyle}>
                    {key}
                  </kbd>
                ))}
              </span>
              <span style={descriptionStyle}>{description}</span>
            </div>
          ))}
        </div>
      )}
      <div style={footerStyle}>[F1] 안내 숨기기</div>
    </div>
  );
}

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 28,
  height: 28,
  padding: "0 7px",
  borderRadius: 6,
  background: "linear-gradient(#f4f6f8, #cfd6dd)",
  color: "#1b2229",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  boxShadow: "0 2px 0 #7f8a95, 0 3px 6px rgba(0,0,0,.35)",
};

const wideChipStyle: CSSProperties = { ...chipStyle, padding: "0 10px" };

const panelStyle: CSSProperties = {
  position: "fixed",
  top: "max(18px, env(safe-area-inset-top, 0px))",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(560px, calc(100vw - 32px))",
  padding: "14px 18px 10px",
  borderRadius: 12,
  background: "rgba(12, 18, 26, 0.82)",
  border: "1px solid rgba(142, 232, 255, 0.35)",
  boxShadow: "0 0 24px rgba(142, 232, 255, 0.12), 0 8px 24px rgba(0,0,0,.4)",
  color: "#e8eef3",
  fontSize: 14,
  lineHeight: 1.55,
  pointerEvents: "none",
  zIndex: 20,
  backdropFilter: "blur(4px)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 6,
  flexWrap: "wrap",
};

const stepBadgeStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "#8ee8ff",
  border: "1px solid rgba(142,232,255,.45)",
  borderRadius: 99,
  padding: "1px 8px",
};

const puzzleBadgeStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "#1b1405",
  background: "#ffd36b",
  borderRadius: 99,
  padding: "1px 8px",
  fontWeight: 700,
};

const titleStyle: CSSProperties = { fontSize: 17, fontWeight: 700 };
const textStyle: CSSProperties = { color: "#c9d4dd" };
const keyListStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 7, marginTop: 10 };
const keyRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
const chipGroupStyle: CSSProperties = { display: "inline-flex", gap: 5 };
const descriptionStyle: CSSProperties = { color: "#e8eef3" };
const footerStyle: CSSProperties = { marginTop: 8, fontSize: 11, color: "#7d8b97", textAlign: "right" };

const flashStyle: CSSProperties = {
  position: "absolute",
  bottom: -32,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "3px 12px",
  borderRadius: 99,
  background: "rgba(90, 210, 140, 0.92)",
  color: "#06210f",
  fontSize: 13,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const collapsedStyle: CSSProperties = {
  position: "fixed",
  top: "max(18px, env(safe-area-inset-top, 0px))",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "4px 12px",
  borderRadius: 99,
  background: "rgba(12, 18, 26, 0.7)",
  color: "#8ee8ff",
  fontSize: 12,
  pointerEvents: "none",
  zIndex: 20,
};
