import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  title: string;
  /** 제목 아래 한 줄(기간 · 기준) */
  meta?: string;
  onClose: () => void;
  children: ReactNode;
  /** 넓은 표를 담을 때 */
  wide?: boolean;
}

/**
 * 가운데 뜨는 창. 숫자 카드를 눌러 「누가 · 몇 명」을 펼쳐 보일 때 쓴다.
 * ESC · 바깥 클릭 · 닫기 단추로 닫히고, 열리는 동안 초점은 창 안에 둔다(WAI-ARIA dialog).
 */
export default function Modal({ title, meta, onClose, children, wide }: ModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={wide ? "adm-modal adm-modal--wide" : "adm-modal"}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="adm-modal__head">
          <div>
            <h2 id={titleId} className="adm-modal__title">
              {title}
            </h2>
            {meta && <p className="adm-modal__meta">{meta}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="adm-button adm-button--ghost adm-button--small"
            onClick={onClose}
          >
            닫기
          </button>
        </header>
        <div className="adm-modal__body">{children}</div>
      </div>
    </div>
  );
}
