import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import searchIcon from "@/assets/images/imgSearchIcon.svg";
import { isComposing } from "@/hooks/useForm";
import { FONT, type CSSVars } from "@/lib/style";
import { COLOR } from "@/styles/tokens";

interface HeaderSearchProps {
  /** 돋보기 크기(px). */
  size?: number;
  onSubmit?: (query: string) => void;
}

/**
 * 머리띠 검색. 돋보기를 누르면 왼쪽으로 밑줄 입력 줄이 열리고, 열린 뒤에는 돋보기가 「찾기」 단추가 된다.
 * 빈 채로 바깥을 누르면 닫히지만 쓰다 만 글이 있으면 열어 둔다.
 */
export default function HeaderSearch({ size = 22, onSubmit }: HeaderSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (inputRef.current?.value.trim()) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  const handleIconClick = () => {
    if (!isOpen) {
      setIsOpen(true);
      return;
    }
    const trimmed = query.trim();
    // 빈 채로 돋보기를 누르면 닫는다. 아무 일도 안 하면 고장으로 보인다.
    if (!trimmed) {
      setIsOpen(false);
      return;
    }
    onSubmit?.(trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 조합 중의 Enter·Esc 는 글자 확정·취소다.
    if (isComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const trimmed = query.trim();
      if (trimmed) onSubmit?.(trimmed);
    } else if (event.key === "Escape") {
      setIsOpen(false);
      setQuery("");
      // 입력 줄이 닫히며 탭 차례에서 빠지므로 초점을 연 단추로 돌려준다.
      buttonRef.current?.focus();
    }
  };

  return (
    // 입력 줄은 돋보기 왼쪽 허공에 띄운다. flex 안에 두면 자라면서 오른쪽 로그인 알약을 밀어낸다.
    <div ref={rootRef} style={rootStyle}>
      <div
        style={{
          ...fieldWrapStyle,
          clipPath: isOpen ? "inset(0 0 0 0)" : "inset(0 0 0 100%)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
        }}
      >
        <input
          ref={inputRef}
          className="text-input header-search__input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          // 닫혀 있을 땐 보이지 않으니 탭 차례에서도 뺀다.
          tabIndex={isOpen ? 0 : -1}
          placeholder="무엇을 찾으세요?"
          aria-label="사이트 안에서 찾기"
          style={inputStyle}
        />
      </div>

      <button
        ref={buttonRef}
        type="button"
        onClick={handleIconClick}
        aria-label={isOpen ? "찾기" : "검색 열기"}
        aria-expanded={isOpen}
        style={iconButtonStyle}
      >
        <img src={searchIcon} alt="" style={{ width: `${size}px`, height: `${size}px`, display: "block" }} />
      </button>
    </div>
  );
}

const rootStyle: CSSProperties = { position: "relative", display: "flex", alignItems: "center", flexShrink: 0 };

const fieldWrapStyle: CSSProperties = {
  position: "absolute",
  right: "32px",
  top: "50%",
  transform: "translateY(-50%)",
  // 폭은 고정하고 잘라 내는 범위만 움직인다. width 를 움직이면 매 프레임 배치를 다시 잰다.
  width: "240px",
  transition: "clip-path .32s cubic-bezier(0.23, 1, 0.32, 1), opacity .24s ease",
};

const inputStyle: CSSVars = {
  width: "240px",
  fontFamily: FONT.mono,
  fontSize: "16px",
  "--placeholder-color": COLOR.textDim,
};

const iconButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};
