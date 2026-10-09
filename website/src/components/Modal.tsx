import { useEffect, useEffectEvent, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { FONT } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

const FIRST_FOCUS_SELECTOR = "input, button, [tabindex]:not([tabindex='-1'])";
const FOCUSABLE_SELECTOR = "input, button, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";
const TITLE_ID = "modal-title";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 상자 폭(px). 좁은 창에서는 양옆 16px 을 남기고 줄어든다. */
  width?: number;
  /** 되돌릴 수 없는 일을 묻는 상자. 제목이 붉어진다. */
  danger?: boolean;
}

/**
 * 페이지 위에 뜨는 대화 상자. 시스템 confirm 창은 이 페이지 결과 따로 놀아 직접 그린다.
 * 1920 무대는 transform 으로 줄어 있어 그 안에서는 fixed 가 무대 기준이 된다. 그래서 body 로 포털한다.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 520,
  danger = false,
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  // onClose 는 부모가 그릴 때마다 새로 생긴다. 의존성에 넣으면 글자를 칠 때마다 초점이 첫 칸으로 튄다.
  const handleClose = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const first = boxRef.current?.querySelector<HTMLElement>(FIRST_FOCUS_SELECTOR);
      (first ?? boxRef.current)?.focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      const box = boxRef.current;
      if (event.key !== "Tab" || !box) return;
      // 키보드 초점이 뒤 페이지로 새지 않게 처음과 끝을 잇는다.
      const focusables = [...box.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => !("disabled" in element && element.disabled),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const previous = previousFocusRef.current;
      if (previous instanceof HTMLElement || previous instanceof SVGElement) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        <div style={headerStyle}>
          <div style={headingStyle}>
            <h2 id={TITLE_ID} style={{ ...titleStyle, color: danger ? "#fca5a5" : COLOR.textBright }}>
              {title}
            </h2>
            {description && <p style={descriptionStyle}>{description}</p>}
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
};

const headingStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "8px" };

const titleStyle: CSSProperties = { margin: 0, fontFamily: FONT.body, fontWeight: 700, fontSize: "22px" };

const descriptionStyle: CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: "15px",
  lineHeight: 1.6,
  color: COLOR.textMuted,
};
