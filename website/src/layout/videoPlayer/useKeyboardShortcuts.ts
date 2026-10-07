import { useEffect, type RefObject } from "react";

// 진행 막대(role="slider")처럼 tabIndex 로 초점을 받는 것도 차례에 넣어야 가두기가 새지 않는다.
const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface KeyboardShortcutOptions {
  boxRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  close: () => Promise<void>;
  togglePlay: () => void;
  seekBy: (delta: number) => void;
  changeVolume: (value: number) => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  scheduleControlsHide: () => void;
  restoreFocus: () => void;
}

/**
 * 유튜브와 같은 단축키(스페이스·K, ←→, ↑↓, M, F, Esc)와 초점 가두기.
 * 모달이 떠 있는 동안 페이지 스크롤을 잠그고, 닫히면 원래 누른 자리로 초점을 돌려준다.
 */
export function useKeyboardShortcuts({
  boxRef,
  videoRef,
  close,
  togglePlay,
  seekBy,
  changeVolume,
  toggleMute,
  toggleFullscreen,
  scheduleControlsHide,
  restoreFocus,
}: KeyboardShortcutOptions) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    boxRef.current?.focus({ preventScroll: true });

    // 음소거 중엔 0 에서 센다. 남은 volume 값에서 세면 ↓ 가 소리를 도로 켠다.
    const audibleVolume = () => (videoRef.current?.muted ? 0 : (videoRef.current?.volume ?? 0));

    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+F(찾기)·Ctrl+R 같은 브라우저 단축키는 그대로 둔다.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // 소리 막대 위 방향키는 막대가 처리한다.
      if (event.target instanceof HTMLInputElement && event.key.startsWith("Arrow")) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        if (!document.fullscreenElement) {
          event.preventDefault();
          void close();
        }
        return;
      }
      if (key === " " || key === "k") {
        if (event.target instanceof HTMLButtonElement && key === " ") return;
        event.preventDefault();
        togglePlay();
      } else if (key === "arrowright") {
        event.preventDefault();
        seekBy(5);
      } else if (key === "arrowleft") {
        event.preventDefault();
        seekBy(-5);
      } else if (key === "arrowup") {
        event.preventDefault();
        changeVolume(audibleVolume() + 0.05);
      } else if (key === "arrowdown") {
        event.preventDefault();
        changeVolume(audibleVolume() - 0.05);
      } else if (key === "m") {
        event.preventDefault();
        toggleMute();
      } else if (key === "f") {
        event.preventDefault();
        toggleFullscreen();
      } else if (key === "tab" && boxRef.current) {
        const focusable = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === boxRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    // 처음엔 조작 막대가 보이는 상태라 숨김 타이머만 건다.
    scheduleControlsHide();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      restoreFocus();
    };
  }, [
    boxRef,
    videoRef,
    close,
    togglePlay,
    seekBy,
    changeVolume,
    toggleMute,
    toggleFullscreen,
    scheduleControlsHide,
    restoreFocus,
  ]);
}
