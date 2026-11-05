import type { CSSProperties, ReactNode } from "react";

import { useLock, useLockControl } from "@/props/combinationLockState";
import { getHeldDrink, useDrink } from "@/props/drinkState";
import { PANEL_SHADOW, UI, UI_FONT } from "@/game/gameUi";
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
  whiteSpace: "pre",
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
  const hint =
    getHeldDrink()?.kind === "paper"
      ? "[H] 힌트함에 넣기   ·   [E] 내려놓기"
      : isHologramAimed
        ? "[E] 또는 클릭 — 전설 속으로"
        : near === NEAR_TARGET.trainExit
          ? "[E] 기차에서 내리기"
          : "";
  if (!hint) return null;
  return <div style={actionHintStyle}>{hint}</div>;
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
export function LockDialPanel() {
  const control = useLockControl();
  const lock = useLock(control?.id);
  if (!control || !lock) return null;
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
            ? "열렸다 — [E] 로 소화전 문을 연다"
            : "← → 칸 고르기 · ↑ ↓ 숫자 돌리기(휠도 된다) · [E] 확인 · ESC 나가기"}
      </div>
    </div>
  );
}
