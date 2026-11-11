/**
 * PC 일시정지 메뉴 — ESC 로 게임 밖에 나왔을 때 뜬다(미르 11/11 「일시정지를 알리는 표식과 함께 설정 창이 나와야」, 나주입장 05 · 08회차).
 * 본편(튜토리얼 · 로비)과 나주가 같이 쓰고, 무엇을 넣을지는 부르는 쪽이 정한다(나주: 기차 · 로비 · 처음부터 다시까지, 본편: 설정 · 조작 · 종료).
 *
 * - 화면 가운데 카드 하나. 뒤는 어둡게 덮어 클릭이 게임으로 가지 않는다(바탕을 눌러도 닫지 않는다 — 계속하기는 단추로만).
 * - 첫 초점은 맨 위 단추(계속하기). Enter 는 초점이 간 단추를 누르고, ↑ · ↓ 로 옮긴다. 마우스를 올려도 같은 자리가 밝아진다.
 * - 한 번 더 묻는 항목(종료 · 나가기 · 처음부터)은 카드 안에서 물음으로 바뀌고, 조작표 같은 읽을거리는 카드 안 다른 쪽으로 넘어간다.
 *   그 쪽에서 ESC 는 「뒤로」. 첫 쪽의 ESC 는 「계속하기」(onEscape, 미르 11/11 「다시 한번 esc 를 누르면 게임 재개」).
 *   다만 ESC 는 몸짓이 아니고 크롬은 ESC 직후 잠금을 거절해 마우스를 바로 잠그지 못한다 — 게임은 바로 이어지고(키로 걷는다)
 *   마우스 시점은 다음 클릭 · 키에 잠긴다(본편 pointerResume · 나주 pointerHold 의 기다림). 자동 반복(누르고 있기)은 받지 않는다.
 * - 등장은 Web Animations 로 — 게임 밖 쉼(html.game-paused)이 CSS 애니메이션을 세워 첫 장면(투명)에 멎는다(08회차 Codex).
 *   Web Animations 는 animation-play-state 를 따르지 않는다. 움직임을 줄인 환경이면 바로 보인다.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { NAVY_FILL, PANEL_SHADOW, UI, UI_FONT } from "./gameUi";
import {
  clearPauseFocus,
  peekPauseFocus,
  rememberPauseFocus,
  setPauseMenuBusy,
  setPauseMenuOpen,
} from "./pauseMenuState";

export type PauseRunResult = { ok: true } | { ok: false; message: string; forceLabel?: string };

/** 한 번 더 묻고 하는 일 */
export interface PauseConfirm {
  question: string;
  note?: string;
  confirmLabel: string;
  /** 하는 동안 보일 글 */
  busyText: string;
  isDanger?: boolean;
  /** 한다. 실패면 문구(+ 「그래도 ~」 단추 이름)를 돌려준다 — 메뉴에 남는다. force 는 「그래도 ~」를 눌렀을 때 */
  run: (force: boolean) => Promise<PauseRunResult>;
}

export interface PauseMenuItem {
  id: string;
  label: string;
  /** 바로 하는 일 */
  onSelect?: () => void;
  confirm?: PauseConfirm;
  /** 카드 안 읽을거리(조작표 등) */
  page?: { title: string; content: ReactNode };
  isDanger?: boolean;
}

interface PauseMenuProps {
  /** 제목 밑 상태 줄(조사 시간 등) */
  status?: ReactNode;
  /** 묶음 사이에 가는 선을 긋는다 */
  groups: PauseMenuItem[][];
  /** 맨 아래 작은 안내(키) */
  footer?: ReactNode;
  /** 계속하기가 막혔을 때 등 — 단추 위에 한 줄 */
  notice?: string | null;
  /** 첫 쪽에서 ESC — 게임으로 돌아간다(계속하기). 없으면 ESC 를 받지 않는다 */
  onEscape?: () => void;
}

type View =
  | { kind: "menu" }
  | { kind: "page"; item: PauseMenuItem }
  | { kind: "confirm"; item: PauseMenuItem; confirm: PauseConfirm; phase: "asking" | "busy" | "failed"; failure?: PauseRunResult };

const BUTTON_SELECTOR = "[data-pause-button]";

export default function PauseMenu({ status, groups, footer, notice, onEscape }: PauseMenuProps) {
  const [view, setView] = useState<View>({ kind: "menu" });
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setPauseMenuOpen(true);
    return () => setPauseMenuOpen(false);
  }, []);

  // 어둡게 깔리고(0.15초) 카드가 살짝 떠오른다
  useLayoutEffect(() => {
    const isReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (isReduced) return;
    backdropRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
    cardRef.current?.animate?.(
      [
        { opacity: 0, transform: "translateY(10px) scale(.98)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 190, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }, []);

  // 메뉴에서 연 창(설정 등)을 닫고 돌아왔으면 그 단추에 — 붙을 때 읽고, 초점을 준 뒤 지운다
  const [returnFocusId] = useState(peekPauseFocus);
  // 쪽이 바뀌면 첫 단추에 초점 — Enter 가 바로 그것을 누른다. 되돌릴 수 없는 물음(처음부터 다시)은 「취소」에
  useEffect(() => {
    const card = cardRef.current;
    const returned =
      view.kind === "menu" && returnFocusId
        ? card?.querySelector<HTMLButtonElement>(`[data-testid="pause-${returnFocusId}"]`)
        : null;
    const first =
      returned ??
      card?.querySelector<HTMLButtonElement>("[data-pause-autofocus]") ??
      card?.querySelector<HTMLButtonElement>(BUTTON_SELECTOR);
    first?.focus({ preventScroll: true });
    clearPauseFocus();
  }, [view.kind, returnFocusId]);

  // 브라우저 「뒤로」로 이 페이지가 캐시(bfcache)에서 되살아나면 첫 쪽으로 — 「로비로 나가기」 · 「게임 종료」를 누른 채 떠난 판은
  // 「~ 중…」에 굳어 단축키까지 막혀(하는 중 = 전부 막음) 어두운 메뉴에 갇혔다(미르 11/11 ESC 암전 조사)
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setView({ kind: "menu" });
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const isBusy = view.kind === "confirm" && view.phase === "busy";
  // 하는 중에는 T · P 까지 막는다 — 메뉴가 내려가 그 일이 뒤에서 끝나지 않게(09회차 Codex)
  useLayoutEffect(() => setPauseMenuBusy(isBusy), [isBusy]);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && view.kind !== "menu") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!isBusy) setView({ kind: "menu" });
        return;
      }
      // 첫 쪽의 ESC = 계속하기 — 게임 쪽 ESC 처리(본편 「밖으로」 등)로 새지 않게 여기서 끝낸다
      if (event.code === "Escape" && onEscapeRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) onEscapeRef.current();
        return;
      }
      if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;
      const buttons = [...(cardRef.current?.querySelectorAll<HTMLButtonElement>(BUTTON_SELECTOR) ?? [])].filter(
        (button) => !button.disabled,
      );
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.code === "ArrowDown" ? 1 : -1;
      const next = index < 0 ? 0 : (index + step + buttons.length) % buttons.length;
      buttons[next].focus({ preventScroll: true });
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [view.kind, isBusy]);

  const select = (item: PauseMenuItem) => {
    if (item.confirm) setView({ kind: "confirm", item, confirm: item.confirm, phase: "asking" });
    else if (item.page) setView({ kind: "page", item });
    else {
      // 계속하기 말고(메뉴가 다시 뜨지 않는다) 창을 여는 항목은 돌아올 때 그 단추에 초점
      if (item.id !== "resume") rememberPauseFocus(item.id);
      item.onSelect?.();
    }
  };

  const run = async (confirm: PauseConfirm, item: PauseMenuItem, force: boolean) => {
    setView({ kind: "confirm", item, confirm, phase: "busy" });
    const result = await confirm.run(force);
    // 성공이면 페이지가 떠난다 — 그대로 「~ 중…」으로 둔다
    if (!result.ok) setView({ kind: "confirm", item, confirm, phase: "failed", failure: result });
  };

  return (
    <div ref={backdropRef} style={backdropStyle} data-hud="일시정지 메뉴" data-pause-menu>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-menu-title"
        style={cardStyle}
      >
        <div style={titleRowStyle}>
          <span aria-hidden style={pauseIconStyle}>
            <span style={pauseBarStyle} />
            <span style={pauseBarStyle} />
          </span>
          <h2 id="pause-menu-title" style={titleStyle}>
            {view.kind === "page" ? view.item.page?.title : "일시정지"}
          </h2>
        </div>
        {view.kind === "menu" && (
          <>
            {status && <div style={statusStyle}>{status}</div>}
            {notice && (
              <p role="alert" style={noticeStyle}>
                {notice}
              </p>
            )}
            <div style={listStyle}>
              {groups.map((group, groupIndex) => (
                <div key={groupIndex} style={groupIndex > 0 ? dividedGroupStyle : groupStyle}>
                  {group.map((item) => (
                    <MenuButton
                      key={item.id}
                      label={item.label}
                      isDanger={item.isDanger}
                      onClick={() => select(item)}
                      testId={`pause-${item.id}`}
                    />
                  ))}
                </div>
              ))}
            </div>
            {footer && <div style={footerStyle}>{footer}</div>}
          </>
        )}
        {view.kind === "page" && (
          <>
            <div style={pageStyle}>{view.item.page?.content}</div>
            <div style={groupStyle}>
              <MenuButton label="뒤로" onClick={() => setView({ kind: "menu" })} testId="pause-back" />
            </div>
            <div style={footerStyle}>Esc 뒤로</div>
          </>
        )}
        {view.kind === "confirm" && (
          <ConfirmView
            view={view}
            onRun={(force) => void run(view.confirm, view.item, force)}
            onBack={() => setView({ kind: "menu" })}
          />
        )}
      </div>
    </div>
  );
}

function ConfirmView({
  view,
  onRun,
  onBack,
}: {
  view: Extract<View, { kind: "confirm" }>;
  onRun: (force: boolean) => void;
  onBack: () => void;
}) {
  const { confirm, phase, failure } = view;
  if (phase === "busy")
    return (
      <p role="status" style={questionStyle}>
        {confirm.busyText}
      </p>
    );
  const failed = phase === "failed" && failure && !failure.ok ? failure : null;
  return (
    <>
      <p style={questionStyle}>{failed ? failed.message : confirm.question}</p>
      {!failed && confirm.note && <p style={noteStyle}>{confirm.note}</p>}
      <div style={groupStyle}>
        <MenuButton
          label={failed ? "다시 해 보기" : confirm.confirmLabel}
          isDanger={confirm.isDanger}
          isFilled
          onClick={() => onRun(false)}
          testId="pause-confirm"
        />
        {failed?.forceLabel && (
          <MenuButton label={failed.forceLabel} onClick={() => onRun(true)} testId="pause-force" />
        )}
        <MenuButton label="취소" onClick={onBack} testId="pause-cancel" isAutoFocus={confirm.isDanger} />
      </div>
      <div style={footerStyle}>Esc 취소</div>
    </>
  );
}

function MenuButton({
  label,
  onClick,
  isDanger = false,
  isFilled = false,
  isAutoFocus = false,
  testId,
}: {
  label: string;
  onClick: () => void;
  isDanger?: boolean;
  isFilled?: boolean;
  /** 쪽이 열릴 때 이 단추에 초점 */
  isAutoFocus?: boolean;
  testId?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const color = isDanger ? UI.danger : UI.text;
  return (
    <button
      type="button"
      data-pause-button
      data-pause-autofocus={isAutoFocus || undefined}
      data-testid={testId}
      onClick={onClick}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      // 마우스와 키보드가 같은 자리 하나를 밝힌다
      onMouseEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
      style={{
        ...buttonStyle,
        color,
        border: `1px solid ${isFocused ? (isDanger ? UI.danger : UI.accent) : isDanger ? "rgba(248,113,113,.4)" : UI.border}`,
        background: isFilled && !isDanger ? NAVY_FILL : isFocused ? UI.surfaceHover : "transparent",
        boxShadow: isFocused ? `0 0 0 1px ${isDanger ? UI.danger : UI.accent}` : "none",
      }}
    >
      {label}
    </button>
  );
}

/** 조작표 한 줄 — 키 칸과 설명 */
export function ControlRows({ rows }: { rows: readonly (readonly [keys: readonly string[], text: string])[] }) {
  return (
    <dl style={rowsStyle}>
      {rows.map(([keys, text]) => (
        <div key={`${keys.join("+")}-${text}`} style={rowStyle}>
          <dt style={keysStyle}>
            {keys.map((key) => (
              <kbd key={key} style={kbdStyle}>
                {key}
              </kbd>
            ))}
          </dt>
          <dd style={rowTextStyle}>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

const backdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  boxSizing: "border-box",
  background: "rgba(2,6,16,.58)",
  backdropFilter: "blur(2px)",
  WebkitBackdropFilter: "blur(2px)",
  overflowY: "auto",
};
const cardStyle: CSSProperties = {
  width: "min(360px, 100%)",
  maxHeight: "100%",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: "20px 20px 14px",
  borderRadius: 16,
  background: UI.glass,
  border: `1px solid ${UI.borderStrong}`,
  boxShadow: PANEL_SHADOW,
  color: UI.text,
  fontFamily: UI_FONT.body,
};
const titleRowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 };
const pauseIconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: 8,
  background: UI.surfaceRaised,
  border: `1px solid ${UI.border}`,
  gap: 4,
};
// 글꼴마다 ❚❚ 가 네모로 깨져 막대 둘을 직접 그린다
const pauseBarStyle: CSSProperties = { width: 4, height: 12, borderRadius: 1, background: UI.accent };
const titleStyle: CSSProperties = { margin: 0, font: `700 20px/1.3 ${UI_FONT.title}`, color: UI.text };
const statusStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 14,
  padding: "10px 12px",
  borderRadius: 10,
  background: UI.surfaceRaised,
  border: `1px solid ${UI.border}`,
  font: `400 13px/1.5 ${UI_FONT.body}`,
  color: UI.textMuted,
};
const noticeStyle: CSSProperties = { margin: "0 0 10px", font: `600 13px/1.5 ${UI_FONT.body}`, color: UI.accent };
const listStyle: CSSProperties = { display: "flex", flexDirection: "column" };
const groupStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const dividedGroupStyle: CSSProperties = {
  ...groupStyle,
  marginTop: 10,
  paddingTop: 10,
  borderTop: `1px solid ${UI.border}`,
};
const buttonStyle: CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 10,
  font: `600 15px/1 ${UI_FONT.body}`,
  cursor: "pointer",
  outline: "none",
  transition: "background .12s, border-color .12s",
};
const footerStyle: CSSProperties = {
  marginTop: 12,
  textAlign: "center",
  font: `400 12px/1.4 ${UI_FONT.body}`,
  color: UI.textSubtle,
};
const questionStyle: CSSProperties = { margin: "0 0 8px", font: `600 15px/1.5 ${UI_FONT.body}`, color: UI.text };
const noteStyle: CSSProperties = { margin: "0 0 12px", font: `400 13px/1.5 ${UI_FONT.body}`, color: UI.textMuted };
const pageStyle: CSSProperties = { marginBottom: 12 };
const rowsStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, margin: 0 };
const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "118px 1fr", alignItems: "center", gap: 10 };
const keysStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4, margin: 0 };
const kbdStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 22,
  height: 22,
  padding: "0 6px",
  borderRadius: 5,
  border: `1px solid ${UI.borderStrong}`,
  background: UI.surfaceRaised,
  font: `600 11px/1 ${UI_FONT.mono}`,
  color: UI.text,
};
const rowTextStyle: CSSProperties = { margin: 0, font: `400 13px/1.4 ${UI_FONT.body}`, color: UI.textMuted };
