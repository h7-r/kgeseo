import type { CSSProperties, ReactNode } from "react";

import { tapKey, useKeyLabels } from "@/engine/input";
import { TOUCH_HUD } from "@/engine/input/touchHudLayout";

import { useLock, useLockControl } from "@/props/combinationLockState";
import { getHeldDrink, useDrink } from "@/props/drinkState";
import { PANEL_SHADOW, UI, UI_FONT, keyCapStyle } from "@/game/gameUi";
import { useToast } from "@/game/toast";
import {
  acceptHintOffer,
  dismissHintOffer,
  isValveLockId,
  useHintOffering,
  useRoamHintOffering,
  useValveHintsDelivered,
  VALVE_ANSWER_LINE,
  VALVE_HINT_LINE,
} from "@/game/valveHelp";
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

/**
 * 크게 보여야 하는 안내(힌트가 새로 들어왔다 · 오래 헤맬 때 밸브로 돌아가자) — 미르 11/10 「텍스트박스랑 글자가 너무 작다」.
 * 글자 14 → 19(휴대폰은 화면 높이에 따라 16~19), 테두리 2px 강조색. 두 줄이 되어도 아래 행동 안내(두 줄이면 위끝 ~106)와 안 겹치게 조금 올린다.
 */
const hintToastStyle: CSSProperties = {
  ...toastStyle,
  bottom: 116,
  font: `700 19px/1.35 ${UI_FONT.body}`,
  padding: "15px 28px",
  borderRadius: 28,
  border: `2px solid ${UI.accent}`,
  maxWidth: "min(680px, calc(100% - 32px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))",
};
const raisedHintToastStyle: CSSProperties = { ...hintToastStyle, bottom: 240 };
/**
 * 터치 — 왼쪽 위 튜토리얼 판(폭 min(340, 42vw), z 950)과 왼쪽 이동 스틱 자리를 피해 그 오른쪽 띠 가운데에,
 * 오른쪽 아래 동작 묶음(앉기 · 점프 · ✋, 아래 10 + 높이 124) 위로 올린다. 글자는 낮은 휴대폰에서 줄인다(16~19).
 * 휴대폰 가로에서 화면 가운데에 두면 튜토리얼 판 밑에 깔렸다(기기 전수 검사).
 */
const touchHintToastStyle: CSSProperties = {
  ...hintToastStyle,
  left: "calc(env(safe-area-inset-left, 0px) + min(340px, 42vw) + 20px)",
  right: `calc(env(safe-area-inset-right, 0px) + ${TOUCH_HUD.edge}px)`,
  transform: "none",
  width: "fit-content",
  maxWidth: "none",
  margin: "0 auto",
  bottom: `calc(env(safe-area-inset-bottom, 0px) + ${TOUCH_HUD.actionBottom + 124 + 12}px)`,
  fontSize: "clamp(16px, calc(1.2vh + 12px), 19px)",
  padding: "12px 22px",
};
/** 터치 자물쇠 — 오른쪽 아래가 다이얼(폭 ~280) 자리라 왼쪽 아래로. 자물쇠 중엔 걷지 않으니 이동 스틱 자리가 비어 있다 */
const TOUCH_LOCK_DIAL_SPACE = 310;
const touchRaisedHintToastStyle: CSSProperties = {
  ...touchHintToastStyle,
  left: "calc(env(safe-area-inset-left, 0px) + 12px)",
  right: `calc(env(safe-area-inset-right, 0px) + ${TOUCH_LOCK_DIAL_SPACE}px)`,
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
  margin: 0,
};

function toastStyleFor(isHint: boolean, isTouch: boolean, raised: boolean): CSSProperties {
  if (!isHint) return raised ? raisedToastStyle : toastStyle;
  if (isTouch) return raised ? touchRaisedHintToastStyle : touchHintToastStyle;
  return raised ? raisedHintToastStyle : hintToastStyle;
}

/** 짧은 안내 한 줄(game/toast) — 눌러 본 결과를 몇 초 알려 준다. 자물쇠 조작 중(raised)엔 자물쇠 안내 위로 올린다 */
export function Toast({ raised = false }: { raised?: boolean }) {
  const toast = useToast();
  const labels = useKeyLabels();
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-hud="안내 한 줄"
      data-emphasis={toast.emphasis}
      style={toastStyleFor(toast.emphasis === "hint", labels.isTouch, raised)}
    >
      {labels.text(toast.message)}
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
  // 밸브 자물쇠에서 오래 막히면 단계별 한 줄(game/valveHelp) — 「예」로 받은 것만(12회차)
  const delivered = useValveHintsDelivered();
  const isOffering = useHintOffering();
  const valveLines =
    isValveLockId(control?.id) && lock && !lock.unlocked
      ? [delivered >= 1 && VALVE_HINT_LINE, delivered >= 2 && VALVE_ANSWER_LINE].filter(Boolean)
      : [];
  if (!control || !lock) return null;
  // 터치 다이얼은 조작 화면 위(z 950)라 창(설정 등)이 뜨면 창을 가린다 — 창이 떠 있거나 나가는 중(카메라 복귀)이면 숨긴다(코덱스 구현 10회차).
  // 추가 힌트를 묻는 동안도 숨긴다 — 그 카드의 예 · 아니요만 누르게
  if (labels.isTouch) return covered || control.phase !== "active" || isOffering ? null : <TouchLockDial />;
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

/**
 * 「추가 힌트를 확인하시겠습니까?」 — 밸브 자물쇠에서 오래 막히면 힌트를 넣기 전에 묻는다(미르 11/9: 시간이 걸려도 제 힘으로
 * 풀고 싶은 사람에게 선택지를, 튜토피드백 12회차). 오답 · 자물쇠를 만진 시간이면 자물쇠 화면에서, 밸브가 다음 장치가 된 뒤
 * 오래 못 풀고 헤매면(미르 11/10) 게임 화면에서(roamVisible — 창 · 연출 · 기차가 아닐 때) 뜬다.
 * 자물쇠 화면: PC 는 잠금이 풀려 있어 눌러도 되고 Y · N 키로도, ESC 는 「아니요」. 터치는 다이얼 대신 이 카드(z 960 — 다이얼 950 위).
 * 게임 화면: PC 는 마우스가 잠겨 있어 Y · N 키로(걷기는 그대로), 터치는 카드 단추.
 */
export function HintOfferCard({ covered = false, roamVisible = false }: { covered?: boolean; roamVisible?: boolean }) {
  const control = useLockControl();
  const isOffering = useHintOffering();
  const isRoamOffering = useRoamHintOffering();
  const labels = useKeyLabels();
  const inLock = control?.phase === "active" && isValveLockId(control.id);
  const inRoam = !control && roamVisible && isRoamOffering;
  if (!isOffering || covered || (!inLock && !inRoam)) return null;
  return (
    <div role="dialog" aria-label="추가 힌트" data-hud="추가 힌트 묻기" style={offerCardStyle}>
      <div style={offerTitleStyle}>추가 힌트를 확인하시겠습니까?</div>
      <div style={offerTextStyle}>
        {labels.text("시간이 걸려도 스스로 풀고 싶다면 「아니요」 — 나중에 힌트함 [H]에서 받을 수 있다.")}
      </div>
      <div style={offerButtonsStyle}>
        <button type="button" style={offerPrimaryStyle} onClick={acceptHintOffer}>
          예{labels.isTouch ? "" : " (Y)"}
        </button>
        <button type="button" style={offerSecondaryStyle} onClick={dismissHintOffer}>
          아니요{labels.isTouch ? "" : " (N)"}
        </button>
      </div>
    </div>
  );
}

const offerCardStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: 960,
  width: "min(420px, calc(100vw - 32px))",
  boxSizing: "border-box",
  padding: "18px 20px 16px",
  borderRadius: 16,
  background: UI.surface,
  border: `1px solid ${UI.accent}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  textAlign: "center",
  pointerEvents: "auto",
  touchAction: "manipulation",
};
const offerTitleStyle: CSSProperties = { font: `700 18px/1.35 ${UI_FONT.title}`, marginBottom: 8 };
const offerTextStyle: CSSProperties = { color: UI.textMuted, font: `400 14px/1.55 ${UI_FONT.body}`, marginBottom: 14 };
const offerButtonsStyle: CSSProperties = { display: "flex", gap: 10, justifyContent: "center" };
const offerButtonStyle: CSSProperties = {
  minWidth: 120,
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 22,
  font: `600 15px/1 ${UI_FONT.body}`,
  cursor: "pointer",
};
const offerPrimaryStyle: CSSProperties = {
  ...offerButtonStyle,
  border: `1px solid ${UI.accent}`,
  background: UI.navy,
  color: UI.text,
};
const offerSecondaryStyle: CSSProperties = {
  ...offerButtonStyle,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  color: UI.text,
};

/**
 * 게임 밖(마우스 잠금 풀림)이면 [T] 로 돌아온다는 걸 알린다 — ESC 를 두 번 눌러(또는 다시 잠그기를 브라우저가 거절해)
 * 커서가 밖으로 나왔을 때 무엇을 해야 할지 몰랐다(미르 11/9, 튜토피드백 12회차). 띄울지는 App 이 정한다. 누르는 것은 없다.
 */
export function ReturnPrompt({ mode }: { mode: "out" | "waiting" }) {
  // waiting — 자물쇠 · 창에서 돌아오려는데 브라우저가 저절로는 잠가 주지 않았다. 다음 클릭 · 키가 잠근다(pointerResume)
  if (mode === "waiting")
    return (
      <div role="status" aria-live="polite" data-hud="게임 밖 안내" style={returnStyle}>
        <div style={returnTitleStyle}>클릭하거나 아무 키나 누르면 이어서</div>
        <div style={returnTextStyle}>
          <kbd style={keyCapStyle}>Esc</kbd> 게임 밖으로
        </div>
      </div>
    );
  return (
    <div role="status" aria-live="polite" data-hud="게임 밖 안내" style={returnStyle}>
      <div style={returnTitleStyle}>게임 밖으로 나왔다</div>
      <div style={returnTextStyle}>
        <kbd style={keyCapStyle}>T</kbd> 를 누르면 게임으로 돌아간다
      </div>
    </div>
  );
}

const returnStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: 45,
  padding: "14px 22px",
  borderRadius: 14,
  background: UI.glass,
  border: `1px solid ${UI.accent}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  textAlign: "center",
  pointerEvents: "none",
  userSelect: "none",
};
const returnTitleStyle: CSSProperties = { font: `700 16px/1.3 ${UI_FONT.title}`, marginBottom: 8 };
const returnTextStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  color: UI.textMuted,
  font: `500 14px/1 ${UI_FONT.body}`,
};
