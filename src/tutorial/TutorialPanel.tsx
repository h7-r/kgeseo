/**
 * 캔버스 밖: 지금 단계의 안내판(키 칩 + 한두 줄 설명). 화면 위 가운데 — 조준점·힌트 표시·[V] 버튼과 안 겹친다.
 * 넘어갈 때 방금 끝낸 단계를 「✓」로 잠깐 보여 줘 눌러 봤더니 됐다는 걸 알게 한다. [F1] 로 숨긴다.
 */
import { useEffect, useState, type CSSProperties } from "react";

import { CheckIcon } from "@/game/gameIcons";
import { useKeyLabels } from "@/engine/input";
import { PANEL_SHADOW, UI, UI_FONT, keyCapStyle } from "@/game/gameUi";

import "@/game/gameUi.css";

import { useDispatchState } from "./dispatchState";
import { TUTORIAL_STEPS, toggleTutorialHidden, useTutorial } from "./tutorialState";

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
  // 터치 모드 — 가로 휴대폰은 높이가 360~430 이라 작은 판을 왼쪽 위(힌트 표시 아래)에 둔다. 문구도 손가락 조작으로
  const labels = useKeyLabels();
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
  if (isHidden)
    return (
      <div style={collapsedStyle}>
        <kbd style={keyCapStyle}>F1</kbd> 안내 보기
      </div>
    );

  const heading = current.puzzle
    ? `퍼즐 ${current.puzzle} / ${PUZZLE_COUNT}`
    : step < CONTROL_STEP_COUNT
      ? `조작 익히기 ${step + 1} / ${CONTROL_STEP_COUNT}`
      : null;
  // 지금 묶음이 어디까지 왔는지 — 글자보다 먼저 눈에 들어온다
  const progress = current.puzzle
    ? current.puzzle / PUZZLE_COUNT
    : step < CONTROL_STEP_COUNT
      ? (step + 1) / CONTROL_STEP_COUNT
      : 1;

  const text = labels.isTouch ? (current.touchText ?? labels.text(current.text)) : current.text;
  const keyRows = labels.isTouch
    ? (current.touchKeys ??
      current.keys.map(([keys, description]) => [keys.map(labels.key), labels.text(description)] as const))
    : current.keys;

  return (
    <div style={labels.isTouch ? touchPanelStyle : panelStyle} role="status" aria-live="polite" data-hud="튜토리얼 판">
      {heading && (
        <div style={progressTrackStyle} aria-hidden>
          <div style={{ ...progressFillStyle, transform: `scaleX(${progress})` }} />
        </div>
      )}
      {flash && (
        <div style={flashStyle}>
          <CheckIcon /> {flash.title}
        </div>
      )}
      <div style={headerStyle}>
        <span style={labels.isTouch ? touchTitleStyle : titleStyle}>{current.title}</span>
        {heading && <span style={stepStyle}>{heading}</span>}
      </div>
      {/* 휴대폰 — 본문 · 조작 칩만 손가락으로 스크롤한다(판 전체에 걸면 판 아래로 뜨는 완료 표시가 잘린다) */}
      <div style={labels.isTouch ? touchScrollStyle : undefined}>
        <div style={textStyle}>
          {text.split("\n").map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
        {keyRows.length > 0 && (
          <div style={labels.isTouch ? touchKeyListStyle : keyListStyle}>
            {keyRows.map(([keys, description], i) => (
              <div key={i} style={keyRowStyle}>
                <span style={keyCapGroupStyle}>
                  {keys.map((key) => (
                    <kbd key={key} style={keyCapStyle}>
                      {key}
                    </kbd>
                  ))}
                </span>
                <span style={descriptionStyle}>{description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {!labels.isTouch && (
        <div style={footerStyle}>
          <kbd style={smallKeyCapStyle}>F1</kbd> 안내 숨기기
        </div>
      )}
    </div>
  );
}

const smallKeyCapStyle: CSSProperties = { ...keyCapStyle, minWidth: 22, height: 20, fontSize: 10, padding: "0 5px" };

const panelStyle: CSSProperties = {
  position: "fixed",
  top: "max(16px, env(safe-area-inset-top, 0px))",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(600px, calc(100vw - 32px))",
  boxSizing: "border-box",
  padding: "18px 22px 12px",
  overflow: "visible",
  borderRadius: 16,
  background: UI.glass,
  border: `1px solid ${UI.border}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  font: `400 15px/1.6 ${UI_FONT.body}`,
  pointerEvents: "none",
  zIndex: 20,
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

/** 터치 — 왼쪽 위 힌트 표시 아래, 화면 폭 42% 이하(11/8 해랑 검토 — 게임 화면을 덜 덮게). 단추 · 조준점과 겹치지 않는다 */
const touchPanelStyle: CSSProperties = {
  ...panelStyle,
  top: "calc(env(safe-area-inset-top, 0px) + 62px)",
  left: "calc(env(safe-area-inset-left, 0px) + 12px)",
  transform: "none",
  width: "min(340px, 42vw)",
  // 글이 길어져도 왼쪽 아래 이동 스틱 자리까지 내려오지 않게 — 넘치면 본문을 손가락으로 스크롤한다(touchScrollStyle).
  // 그래서 터치 조작면(z 900) 위에 두고 손가락을 받는다(이 판 위에서는 시점이 돌지 않는다, 코덱스 14c)
  pointerEvents: "auto",
  zIndex: 950,
  padding: "8px 12px",
  borderRadius: 12,
  // 14px — 휴대폰에서 읽히는 본문 크기(14회차, 예전 12.5). 줄 간격은 창들과 같은 1.5
  font: `400 14px/1.5 ${UI_FONT.body}`,
};
// 판 머리(약 30px) · 위아래 여백을 뺀 나머지 — 화면 높이 기준(dvh)
const touchScrollStyle: CSSProperties = {
  maxHeight: "calc(100dvh - 62px - 100px - 44px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
  overflowY: "auto",
  overscrollBehavior: "contain",
  touchAction: "pan-y",
};
const touchTitleStyle: CSSProperties = { font: `700 15px/1.3 ${UI_FONT.title}`, color: UI.text };
const touchKeyListStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  columnGap: 14,
  rowGap: 4,
  marginTop: 6,
  paddingTop: 6,
  borderTop: `1px solid ${UI.border}`,
};

const progressTrackStyle: CSSProperties = {
  position: "absolute",
  left: 16,
  right: 16,
  top: -1,
  height: 2,
  overflow: "hidden",
  background: UI.border,
};
const progressFillStyle: CSSProperties = {
  height: "100%",
  background: UI.accent,
  transformOrigin: "left",
  transition: "transform 420ms cubic-bezier(0.16, 1, 0.3, 1)",
};

const headerStyle: CSSProperties = { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 };
const stepStyle: CSSProperties = {
  marginLeft: "auto",
  whiteSpace: "nowrap",
  color: UI.accent,
  font: `500 13px/1 ${UI_FONT.mono}`,
  fontVariantNumeric: "tabular-nums",
};
const titleStyle: CSSProperties = { font: `700 20px/1.3 ${UI_FONT.title}`, color: UI.text };
const textStyle: CSSProperties = { color: UI.textMuted };
// 키 칩은 한 줄에 가로로 — 세로로 쌓으면 안내판이 퍼즐을 가린다
const keyListStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  columnGap: 26,
  rowGap: 8,
  marginTop: 12,
  paddingTop: 12,
  borderTop: `1px solid ${UI.border}`,
};
const keyRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const keyCapGroupStyle: CSSProperties = { display: "inline-flex", gap: 4 };
const descriptionStyle: CSSProperties = { color: UI.text, fontSize: 14 };
const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
  marginTop: 10,
  color: UI.textSubtle,
  font: `400 12px/1 ${UI_FONT.body}`,
};

const flashStyle: CSSProperties = {
  position: "absolute",
  bottom: -40,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 14px",
  borderRadius: 15,
  background: UI.glass,
  border: `1px solid ${UI.success}`,
  color: UI.success,
  font: `600 13px/1 ${UI_FONT.body}`,
  whiteSpace: "nowrap",
  animation: "game-notice-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both",
};

const collapsedStyle: CSSProperties = {
  position: "fixed",
  top: "max(16px, env(safe-area-inset-top, 0px))",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  height: 42,
  padding: "0 16px 0 8px",
  boxSizing: "border-box",
  borderRadius: 21,
  background: UI.glass,
  border: `1px solid ${UI.border}`,
  color: UI.text,
  font: `500 13px/1 ${UI_FONT.body}`,
  pointerEvents: "none",
  zIndex: 20,
};
