/**
 * 터치 조작 화면(본편 · 나주 공용) — 조작 중(가상 잠금)일 때만 뜬다. 창이 열리면 잠금이 풀려 저절로 숨는다.
 *
 * ┌──────────────────────────────────────────────┐
 * │                         [시점] [🎒] [💡] [⚙] [Ⅱ] │
 * │                     ＋                         │
 * │   ( ◎ )                           [앉기]       │
 * │  이동 스틱        시점 드래그       [점프] (✋)  │
 * ✋ 위 오른쪽 칸은 비워 둔다 — 나주 퍼즐 안내창(PuzzlePanelHud)이 단추 줄 아래 그 자리에 뜬다.
 * └──────────────────────────────────────────────┘
 * · 왼쪽 40% 아무 곳 = 닿은 자리에 생기는 스틱(아날로그). 끝까지 밀면 달리기.
 * · 나머지 = 시점 드래그. 손가락마다 따로 추적하고, 한 손가락은 한 조작만 맡는다.
 * · 화면 가장자리는 비운다 — 안드로이드 뒤로 가기 · iOS 쓸어 넘기기 · 홈 표시줄과 겹치지 않게.
 * · pointerdown 에서 preventDefault — 터치가 만드는 호환 mouse 이벤트(주먹 등)와 길게 눌러 뜨는 메뉴를 막는다.
 * · 버튼은 최종 크기 48 CSS px 이상.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { pauseGame, useGamePauseState } from "./gamePause";
import { addCancelListener, addTouchLook, cancelKey, pressKey, releaseKey, setTouchMove } from "./touchInput";
import { useTouchMode } from "./touchMode";
import { addPointerActiveListener, isVirtuallyLocked } from "./virtualLock";

/**
 * 유령 클릭 거르기 — 손가락을 떼면 브라우저가 그 자리에 click 을 하나 더 만든다.
 * 단추가 창(소지품 · 설정)이나 덮개를 띄우면 그 click 이 새로 뜬 창의 바깥 배경에 떨어져 창이 바로 닫힌다.
 * 화면 단추를 뗀 직후 같은 자리 근처의 click 하나를 캡처 단계에서 삼킨다.
 */
const GHOST_CLICK = { ms: 500, px: 32 };
let lastRelease: { x: number; y: number; at: number } | null = null;
/** 화면 단추에서 시작한 손가락 — 단추가 창을 띄우며 사라져도 떼는 순간을 페이지 전체에서 잡는다 */
const buttonPointers = new Set<number>();
if (typeof window !== "undefined") {
  const recordRelease = (event: globalThis.PointerEvent) => {
    if (!buttonPointers.delete(event.pointerId)) return;
    if (event.type === "pointerup" && event.pointerType === "touch") {
      lastRelease = { x: event.clientX, y: event.clientY, at: performance.now() };
    }
  };
  window.addEventListener("pointerup", recordRelease, { capture: true });
  window.addEventListener("pointercancel", recordRelease, { capture: true });
  // 새 손가락이 닿으면 새 몸짓이다 — 앞 손가락의 click 이 끝내 오지 않았어도 거르기를 끝낸다(정당한 다음 탭을 삼키지 않게)
  window.addEventListener("pointerdown", () => (lastRelease = null), { capture: true });
  window.addEventListener(
    "click",
    (event) => {
      const last = lastRelease;
      if (!last || performance.now() - last.at > GHOST_CLICK.ms) return;
      // 마우스로 누른 click 은 거르지 않는다(PC · 아이패드 마우스)
      if ((event as globalThis.PointerEvent).pointerType === "mouse") return;
      if (Math.hypot(event.clientX - last.x, event.clientY - last.y) > GHOST_CLICK.px) return;
      lastRelease = null;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
}

/** 스틱 반지름(px) — 이만큼 밀면 최대 */
const STICK_RADIUS = 56;
/** 왼쪽 이 비율까지가 스틱 자리 */
const STICK_AREA = 0.4;
/** 화면 가장자리 이 폭은 시스템 제스처 몫 */
const EDGE = 20;

export interface TouchButton {
  code: string;
  label: ReactNode;
  ariaLabel: string;
}

interface TouchHudProps {
  /** 위쪽 줄에 더 붙일 단추(본편의 시점 전환 등) */
  extraTopButtons?: TouchButton[];
  /** 오른쪽 아래 동작 묶음(앉기 · 점프 · ✋)을 숨긴다 — 자물쇠처럼 그 자리를 다른 조작판이 쓸 때 */
  hideActions?: boolean;
}

interface Finger {
  id: number;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
}

export function TouchHud({ extraTopButtons = [], hideActions = false }: TouchHudProps) {
  const isTouch = useTouchMode();
  const { hasStarted, isPaused } = useGamePauseState();
  const [isLocked, setIsLocked] = useState(isVirtuallyLocked);
  useEffect(() => addPointerActiveListener(() => setIsLocked(isVirtuallyLocked())), []);

  if (!isTouch || !hasStarted || isPaused || !isLocked) return null;
  return (
    <div style={rootStyle}>
      <MoveLookSurface />
      <div style={topRightStyle} data-hud="위 단추 줄">
        {extraTopButtons.map((button) => (
          <KeyButton key={button.code} code={button.code} ariaLabel={button.ariaLabel} size={48}>
            {button.label}
          </KeyButton>
        ))}
        <KeyButton code="KeyI" ariaLabel="소지품" size={48}>
          🎒
        </KeyButton>
        <KeyButton code="KeyH" ariaLabel="힌트" size={48}>
          💡
        </KeyButton>
        <KeyButton code="KeyP" ariaLabel="설정" size={48}>
          ⚙
        </KeyButton>
        {/* 왼쪽 위는 힌트 표시 자리라 멈춤은 오른쪽 끝. 손을 뗄 때 멈춘다 — 누르는 순간 멈추면
            그 손가락의 클릭이 곧 뜬 「눌러서 계속」을 눌러 바로 풀린다 */}
        <PadButton ariaLabel="멈춤" size={48} onPress={() => {}} onRelease={pauseGame}>
          Ⅱ
        </PadButton>
      </div>
      {!hideActions && (
        <div style={actionClusterStyle} data-hud="동작 단추">
          <KeyButton code="KeyC" ariaLabel="앉기" size={56} style={{ position: "absolute", right: 106, bottom: 80 }}>
            앉기
          </KeyButton>
          <KeyButton code="Space" ariaLabel="점프" size={60} style={{ position: "absolute", right: 104, bottom: 8 }}>
            점프
          </KeyButton>
          <KeyButton
            code="KeyE"
            ariaLabel="쓰기"
            size={84}
            style={{ position: "absolute", right: 0, bottom: 0 }}
            strong
          >
            ✋
          </KeyButton>
        </div>
      )}
    </div>
  );
}

/** 왼쪽 = 스틱, 오른쪽 = 시점 */
function MoveLookSurface() {
  const stick = useRef<Finger | null>(null);
  const look = useRef<Finger | null>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  const showStick = (x: number, y: number, knobX: number, knobY: number, visible: boolean) => {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;
    base.style.opacity = visible ? "1" : "0";
    base.style.transform = `translate(${x - STICK_RADIUS}px, ${y - STICK_RADIUS}px)`;
    knob.style.transform = `translate(${knobX}px, ${knobY}px)`;
  };

  const releaseStick = () => {
    stick.current = null;
    setTouchMove(0, 0);
    showStick(0, 0, 0, 0, false);
  };

  useEffect(
    () =>
      addCancelListener(() => {
        look.current = null;
        if (!stick.current) return;
        stick.current = null;
        setTouchMove(0, 0);
        if (baseRef.current) baseRef.current.style.opacity = "0";
      }),
    [],
  );
  // 화면이 사라질 때(창 열림 · 멈춤) 스틱 값을 남기지 않는다
  useEffect(() => () => setTouchMove(0, 0), []);

  const handleDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const { clientX: x, clientY: y } = event;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (x < EDGE || x > width - EDGE || y > height - EDGE) return;
    const finger: Finger = { id: event.pointerId, originX: x, originY: y, lastX: x, lastY: y };
    if (x < width * STICK_AREA) {
      if (stick.current) return;
      stick.current = finger;
      showStick(x, y, 0, 0, true);
    } else {
      if (look.current) return;
      look.current = finger;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (s && s.id === event.pointerId) {
      let dx = event.clientX - s.originX;
      let dy = event.clientY - s.originY;
      const length = Math.hypot(dx, dy);
      if (length > STICK_RADIUS) {
        dx *= STICK_RADIUS / length;
        dy *= STICK_RADIUS / length;
      }
      // 가운데 10% 는 무감 — 엄지를 얹기만 해도 미끄러지지 않게
      const strength = Math.min(1, length / STICK_RADIUS);
      if (strength < 0.1) setTouchMove(0, 0);
      else setTouchMove(dx / STICK_RADIUS, -dy / STICK_RADIUS);
      showStick(s.originX, s.originY, dx, dy, true);
      return;
    }
    const l = look.current;
    if (l && l.id === event.pointerId) {
      addTouchLook(event.clientX - l.lastX, event.clientY - l.lastY);
      l.lastX = event.clientX;
      l.lastY = event.clientY;
    }
  };

  const handleUp = (event: PointerEvent<HTMLDivElement>) => {
    if (stick.current?.id === event.pointerId) releaseStick();
    if (look.current?.id === event.pointerId) look.current = null;
  };

  return (
    <div
      style={surfaceStyle}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onLostPointerCapture={handleUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div ref={baseRef} style={stickBaseStyle}>
        <div ref={knobRef} style={stickKnobStyle} />
      </div>
    </div>
  );
}

interface PadButtonProps {
  ariaLabel: string;
  size: number;
  style?: CSSProperties;
  strong?: boolean;
  children: ReactNode;
  onPress: () => void;
  onRelease?: () => void;
  onCancel?: () => void;
}

/** 누르는 동안 밝아지는 동그란 단추. 눌림 · 정상 놓기 · 취소를 따로 알린다 */
function PadButton({ ariaLabel, size, style, strong, children, onPress, onRelease, onCancel }: PadButtonProps) {
  /** 이 단추를 누르고 있는 손가락 — 처음 누른 손가락만 주인이다(두 번째 손가락을 떼도 놓은 게 아니다) */
  const owner = useRef<number | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const releaseRef = useRef(onRelease);
  useEffect(() => {
    releaseRef.current = onRelease;
  });
  // 누른 채로 단추가 사라지면(창이 열려 조작 화면이 숨음) 놓은 것으로 친다 — 가상 키가 눌린 채 남으면 다음 누름이 막힌다
  useEffect(
    () => () => {
      if (owner.current === null) return;
      owner.current = null;
      releaseRef.current?.();
    },
    [],
  );

  useEffect(
    () =>
      addCancelListener(() => {
        owner.current = null;
        setIsPressed(false);
      }),
    [],
  );

  const end = (pointerId: number, isCancel: boolean) => {
    if (owner.current !== pointerId) return;
    owner.current = null;
    setIsPressed(false);
    if (isCancel) onCancel?.();
    else onRelease?.();
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      style={{
        ...padButtonStyle,
        width: size,
        height: size,
        // 글자 단추(앉기 · 점프 · 시점)는 작게, 그림 단추는 크게
        fontSize: typeof children === "string" && children.length > 1 ? 15 : size >= 80 ? 32 : 20,
        background: isPressed ? "rgba(242,238,228,0.42)" : strong ? "rgba(242,238,228,0.22)" : "rgba(20,22,28,0.45)",
        ...style,
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (owner.current !== null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        owner.current = event.pointerId;
        buttonPointers.add(event.pointerId);
        setIsPressed(true);
        onPress();
      }}
      onPointerUp={(event) => end(event.pointerId, false)}
      onPointerCancel={(event) => end(event.pointerId, true)}
      // 정상으로 떼도 이 이벤트가 뒤따른다 — 이미 끝났으면 무시된다
      onLostPointerCapture={(event) => end(event.pointerId, true)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  );
}

/** 가상 키를 누르고 떼는 단추. 이 손가락만 취소되면 그 키만 정리한다(다른 손의 스틱은 그대로) */
function KeyButton({ code, ...rest }: Omit<PadButtonProps, "onPress" | "onRelease" | "onCancel"> & { code: string }) {
  return (
    <PadButton
      {...rest}
      onPress={() => pressKey(code)}
      onRelease={() => releaseKey(code)}
      onCancel={() => cancelKey(code)}
    />
  );
}

const noTouchDefaults: CSSProperties = {
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
};

const rootStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 900,
  pointerEvents: "none",
  ...noTouchDefaults,
};

const surfaceStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "auto",
  ...noTouchDefaults,
};

const stickBaseStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: STICK_RADIUS * 2,
  height: STICK_RADIUS * 2,
  borderRadius: "50%",
  border: "2px solid rgba(242,238,228,0.35)",
  background: "rgba(20,22,28,0.25)",
  opacity: 0,
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const stickKnobStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: "50%",
  background: "rgba(242,238,228,0.55)",
  pointerEvents: "none",
};

const padButtonStyle: CSSProperties = {
  pointerEvents: "auto",
  border: "1.5px solid rgba(242,238,228,0.4)",
  borderRadius: "50%",
  color: "#F2EEE4",
  fontFamily: "sans-serif",
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  ...noTouchDefaults,
};

const topRightStyle: CSSProperties = {
  position: "absolute",
  right: "calc(env(safe-area-inset-right) + 12px)",
  top: "calc(env(safe-area-inset-top) + 12px)",
  display: "flex",
  gap: 8,
};

const actionClusterStyle: CSSProperties = {
  position: "absolute",
  right: "calc(env(safe-area-inset-right) + 24px)",
  bottom: "calc(env(safe-area-inset-bottom) + 20px)",
  width: 170,
  height: 140,
};
