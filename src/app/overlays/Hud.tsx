import type { CSSProperties, ReactNode } from "react";

import { tapKey, useKeyLabels } from "@/engine/input";

import { useLock, useLockControl } from "@/props/combinationLockState";
import { getHeldDrink, useDrink } from "@/props/drinkState";
import { PANEL_SHADOW, UI, UI_FONT } from "@/game/gameUi";
import { useToast } from "@/game/toast";
import { isValveLockId, useValveHelpStage, VALVE_ANSWER_LINE, VALVE_HINT_LINE } from "@/game/valveHelp";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";
import { useIsHologramAimed } from "@/trainInterior/hologramAim";

import "@/game/gameUi.css";

// 게임 화면 위에 얹는 작은 표시들. 모두 App 한 곳에서만 쓴다.

const crosshairStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 5,
  height: 5,
  marginLeft: -2.5,
  marginTop: -2.5,
  borderRadius: "50%",
  background: "rgba(240,244,250,.55)",
  pointerEvents: "none",
};

/** 1인칭은 커서가 없으니 화면 한가운데가 커서다. */
export function Crosshair() {
  return <div style={crosshairStyle} />;
}

const curtainStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#000",
  transition: "opacity 260ms ease",
  // 화면을 덮어도 클릭·마우스는 그대로 통과시킨다.
  pointerEvents: "none",
  zIndex: 50,
};

interface FadeCurtainProps {
  /** 0 투명 · 1 검정 */
  opacity: number;
}

/** 씬 전환용 검은 막. transition 으로만 움직여 자바스크립트가 매 프레임 끼어들지 않는다. */
export function FadeCurtain({ opacity }: FadeCurtainProps) {
  return <div style={{ ...curtainStyle, opacity }} />;
}

const topBarButtonStyle: CSSProperties = {
  position: "fixed",
  top: 16,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  gap: 7,
  height: 42,
  padding: "0 16px",
  border: `1px solid ${UI.border}`,
  borderRadius: 21,
  background: UI.glass,
  color: UI.text,
  font: `500 13px/1 ${UI_FONT.body}`,
  cursor: "pointer",
};

interface TopBarButtonProps {
  /** 화면 오른쪽에서 떨어진 거리(px). 튜토리얼 안내판과 겹치지 않게 오른쪽 끝에 붙인다. */
  right: number;
  onClick: () => void;
  ariaLabel?: string;
  children: ReactNode;
}

/** 오른쪽 위 작은 단추(⚙ 설정 · [V] 시점) */
export function TopBarButton({ right, onClick, ariaLabel, children }: TopBarButtonProps) {
  return (
    <button
      type="button"
      className="game-top-button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{ ...topBarButtonStyle, right }}
    >
      {children}
    </button>
  );
}

const actionHintStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 40,
  transform: "translateX(-50%)",
  color: UI.text,
  font: `500 14px/1 ${UI_FONT.body}`,
  background: UI.glass,
  border: `1px solid ${UI.borderStrong}`,
  boxShadow: PANEL_SHADOW,
  padding: "13px 20px",
  borderRadius: 22,
  // 줄바꿈은 글에 적힌 대로, 좁은 휴대폰 가로에서는 폭 안에서 접는다(14회차 — 예전 pre 라 화면 밖으로 나갔다)
  whiteSpace: "pre-line",
  lineHeight: 1.35,
  textAlign: "center",
  maxWidth: "calc(100% - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px))",
  boxSizing: "border-box",
  pointerEvents: "none",
};

interface ActionHintProps {
  near: NearTarget;
}

/**
 * 화면 아래 안내문. 겨냥한 물건은 스스로 빛나므로 글로 적지 않는다.
 * 남는 건 빛낼 대상이 없는 이동, 그리고 손에 든 것에 키가 둘 이상 걸린 때(쪽지: [E] 와 [H] 가 다른 일)뿐이다.
 */
export function ActionHint({ near }: ActionHintProps) {
  // 판 번호만 구독한다. 집고 버리는 순간에만 바뀌어 자주 다시 그려지지 않는다.
  useDrink();
  const isHologramAimed = useIsHologramAimed();
  const labels = useKeyLabels();
  // 기차 출구 앞에서는 [E] 가 내리기 먼저다(useGameKeys handleUse) — 안내도 같은 순서
  const hint = isHologramAimed
    ? "[E] 또는 클릭 — 전설 속으로"
    : near === NEAR_TARGET.trainExit || near === NEAR_TARGET.trainExitDoor
      ? "[E] 기차에서 내리기   ·   문으로 걸어 나가도 내려요"
      : getHeldDrink()?.kind === "paper"
        ? "[H] 힌트함에 넣기   ·   [E] 내려놓기"
        : "";
  if (!hint) return null;
  return <div style={actionHintStyle}>{labels.text(hint)}</div>;
}

const toastStyle: CSSProperties = {
  ...actionHintStyle,
  // 행동 안내(아래 40) 바로 위 — 둘이 함께 떠도 겹치지 않는다
  bottom: 104,
  fontWeight: 600,
  borderColor: UI.accent,
};
// 자물쇠 안내(글자 줄 + 키 안내 + 밸브 힌트 두 줄)가 아래 약 215 까지 차지한다
const raisedToastStyle: CSSProperties = { ...toastStyle, bottom: 240 };

/** 짧은 안내 한 줄(game/toast) — 눌러 본 결과를 몇 초 알려 준다. 자물쇠 조작 중(raised)엔 자물쇠 안내 위로 올린다 */
export function Toast({ raised = false }: { raised?: boolean }) {
  const text = useToast();
  const labels = useKeyLabels();
  if (!text) return null;
  return (
    <div role="status" aria-live="polite" style={raised ? raisedToastStyle : toastStyle}>
      {labels.text(text)}
    </div>
  );
}

const lockPanelStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 42,
  transform: "translateX(-50%)",
  zIndex: 40,
  display: "grid",
  justifyItems: "center",
  gap: 10,
  pointerEvents: "none",
  textAlign: "center",
};

const lockRowsStyle: CSSProperties = { display: "flex", gap: 6 };

const lockRowStyle: CSSProperties = {
  minWidth: 30,
  padding: "5px 0",
  borderRadius: 5,
  border: `1px solid ${UI.border}`,
  background: UI.glass,
  color: UI.text,
  font: `600 19px/1.1 ${UI_FONT.mono}`,
};

const selectedLockRowStyle: CSSProperties = {
  ...lockRowStyle,
  border: `1px solid ${UI.accent}`,
  background: UI.surfaceHover,
  color: UI.text,
};

const lockGuideStyle: CSSProperties = {
  padding: "9px 16px",
  borderRadius: 18,
  background: UI.glass,
  border: `1px solid ${UI.border}`,
  color: UI.textMuted,
  font: `400 13px/1.4 ${UI_FONT.body}`,
};

/**
 * 자물쇠를 만지는 동안 지금 돌리는 칸과 키 안내. 숫자는 3D 자물쇠에서 읽게 하고 여기서는 키만 알려 준다.
 * App 에서 떼어 둔 이유: 다이얼을 App 이 구독하면 키 한 번에 App 과 Canvas 자식 전체가 다시 그려진다.
 */
export function LockDialPanel({ covered = false }: { covered?: boolean }) {
  const control = useLockControl();
  const lock = useLock(control?.id);
  const labels = useKeyLabels();
  // 밸브 자물쇠에서 오래 막히면 단계별 한 줄(game/valveHelp)
  const valveStage = useValveHelpStage();
  const valveLines =
    isValveLockId(control?.id) && lock && !lock.unlocked
      ? [valveStage >= 1 && VALVE_HINT_LINE, valveStage >= 2 && VALVE_ANSWER_LINE].filter(Boolean)
      : [];
  if (!control || !lock) return null;
  // 터치 다이얼은 조작 화면 위(z 950)라 창(설정 등)이 뜨면 창을 가린다 — 창이 떠 있거나 나가는 중(카메라 복귀)이면 숨긴다(코덱스 구현 10회차)
  if (labels.isTouch) return covered || control.phase !== "active" ? null : <TouchLockDial />;
  return (
    <div style={lockPanelStyle}>
      <div style={lockRowsStyle}>
        {lock.digits.map((digit, row) => (
          <span key={row} style={row === lock.selectedRow ? selectedLockRowStyle : lockRowStyle}>
            {lock.glyphs[row]?.[digit] ?? "?"}
          </span>
        ))}
      </div>
      <div style={lockGuideStyle}>
        {lock.submitting
          ? "Backend에서 확인 중..."
          : lock.unlocked
            ? // 밸브 자물쇠는 맞은편 배전반 문도 같이 연다(10회차). 다른 자물쇠(차단기함)에 소화전 문구가 뜨던 것도 가른다
              isValveLockId(control.id)
              ? "열렸다 — 맞은편 배전반도 함께 열린다 · 소화전 문은 [E]"
              : "열렸다"
            : "← → 칸 고르기 · ↑ ↓ 숫자 돌리기(휠도 된다) · [E] 확인 · ESC 나가기"}
      </div>
      {valveLines.map((line) => (
        <div key={String(line)} style={{ ...lockGuideStyle, color: UI.accent, fontWeight: 600 }}>
          {labels.text(String(line))}
        </div>
      ))}
    </div>
  );
}

/**
 * 터치 자물쇠 — 칸마다 ▲ ▼, 칸을 누르면 그 칸을 고른다, [열기] · [나가기].
 * 판정 · 소리 · 열림 연출은 키보드 길(useGameKeys 의 handleLockKey)을 그대로 쓴다: ← → ↑ ↓ · Enter · Escape 가상 키.
 * 조작 화면(z 900) 위에 둬야 손가락이 닿는다.
 */
function TouchLockDial() {
  const control = useLockControl();
  const lock = useLock(control?.id);
  if (!control || !lock) return null;
  const goToRow = (row: number) => {
    const steps = row - lock.selectedRow;
    const code = steps > 0 ? "ArrowRight" : "ArrowLeft";
    for (let i = 0; i < Math.abs(steps); i += 1) tapKey(code);
  };
  const turn = (row: number, direction: 1 | -1) => {
    goToRow(row);
    tapKey(direction > 0 ? "ArrowUp" : "ArrowDown");
  };
  return (
    <div style={touchLockPanelStyle} data-hud="자물쇠 다이얼">
      <div style={lockRowsStyle}>
        {lock.digits.map((digit, row) => (
          <div key={row} style={touchLockColumnStyle}>
            <button
              type="button"
              style={touchLockArrowStyle}
              aria-label={`${row + 1}번째 칸 올리기`}
              onClick={() => turn(row, 1)}
            >
              ▲
            </button>
            <button
              type="button"
              style={{ ...(row === lock.selectedRow ? selectedLockRowStyle : lockRowStyle), ...touchLockGlyphStyle }}
              aria-label={`${row + 1}번째 칸 고르기`}
              onClick={() => goToRow(row)}
            >
              {lock.glyphs[row]?.[digit] ?? "?"}
            </button>
            <button
              type="button"
              style={touchLockArrowStyle}
              aria-label={`${row + 1}번째 칸 내리기`}
              onClick={() => turn(row, -1)}
            >
              ▼
            </button>
          </div>
        ))}
      </div>
      <div style={touchLockActionsStyle}>
        <button type="button" style={touchLockActionStyle} onClick={() => tapKey("Escape")}>
          나가기
        </button>
        <button
          type="button"
          style={{ ...touchLockActionStyle, ...touchLockPrimaryStyle }}
          disabled={lock.submitting}
          onClick={() => tapKey("Enter")}
        >
          {lock.submitting ? "확인 중…" : lock.unlocked ? "열렸다" : "열기"}
        </button>
      </div>
    </div>
  );
}

/**
 * 터치 — 오른쪽 아래, 숨긴 앉기 · 점프 · ✋ 자리(오른손 엄지가 닿는 곳). 가운데에 두면 왼쪽 위 튜토리얼 판과 겹치고
 * (667 · 노치 가로, HUD 검사 3판) 화면 가운데 3D 자물쇠도 가렸다
 */
const touchLockPanelStyle: CSSProperties = {
  ...lockPanelStyle,
  left: "auto",
  right: "calc(env(safe-area-inset-right, 0px) + 16px)",
  transform: "none",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  zIndex: 950,
  pointerEvents: "auto",
  touchAction: "manipulation",
  userSelect: "none",
  WebkitUserSelect: "none",
};
const touchLockColumnStyle: CSSProperties = { display: "grid", justifyItems: "center", gap: 4 };
// 누르는 영역 44(Apple HIG) — 예전 40(14회차)
const touchLockArrowStyle: CSSProperties = {
  width: 48,
  height: 44,
  borderRadius: 10,
  border: `1px solid ${UI.border}`,
  background: UI.glass,
  color: UI.text,
  fontSize: 16,
  padding: 0,
};
const touchLockGlyphStyle: CSSProperties = {
  width: 48,
  minHeight: 44,
  font: `600 22px/1.1 ${UI_FONT.mono}`,
  padding: 0,
};
const touchLockActionsStyle: CSSProperties = { display: "flex", gap: 10 };
const touchLockActionStyle: CSSProperties = {
  minWidth: 96,
  height: 48,
  borderRadius: 24,
  border: `1px solid ${UI.border}`,
  background: UI.glass,
  color: UI.text,
  font: `600 15px/1 ${UI_FONT.body}`,
};
const touchLockPrimaryStyle: CSSProperties = { border: `1px solid ${UI.accent}`, background: UI.surfaceHover };
