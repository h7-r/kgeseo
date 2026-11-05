/**
 * 나주 전역 단축키 — 창을 여닫는 키는 마우스 잠금도 같이 다룬다(창이 열리면 마우스가 필요하고, 닫히면 바로 걷는다).
 *   [P] 설정 · [I] 소지품(손에 든 것이 있으면 그것을 넣는다) · [T] 시작 · [H] 힌트함 · [V] 시점 · [Esc] 닫기
 */
import { useEffect, type RefObject } from "react";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import { addHint } from "@/game/hintBox";

import { isHintBoxOpen, setHintBoxOpen } from "../puzzles/hintBoxView";
import { inventory } from "../puzzles/inventory";
import {
  PAPER_HINT,
  closePaper,
  getOldPaperCanvas,
  isPaperOpenNow,
  paperHintDescription,
} from "../puzzles/ridge/oldPaper";
import { ALLOW_VIEW_TOGGLE } from "./runtimeFlags";

interface GameHotkeys {
  controlsRef: RefObject<PointerLockControlsImpl | null>;
  isLocked: boolean;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isInventoryOpen: boolean;
  setIsInventoryOpen: (open: boolean) => void;
  /** 모은 힌트 수 — 하나라도 있어야 [H] 로 힌트함이 열린다 */
  hintCount: number;
  toggleViewMode: () => void;
}

const isTyping = (target: EventTarget | null) =>
  /INPUT|TEXTAREA|SELECT/.test((target as HTMLElement | null)?.tagName ?? "");

const isPlainPress = (event: KeyboardEvent) => !event.repeat && !isTyping(event.target);

export function useGameHotkeys({
  controlsRef,
  isLocked,
  isSettingsOpen,
  setIsSettingsOpen,
  isInventoryOpen,
  setIsInventoryOpen,
  hintCount,
  toggleViewMode,
}: GameHotkeys) {
  useEffect(() => {
    const controls = () => controlsRef.current;

    const handleHintKey = () => {
      // 본부실처럼 — 쪽지를 읽는 중이면 힌트함에 적어 넣고 연다
      if (isPaperOpenNow()) {
        addHint({
          ...PAPER_HINT,
          description: paperHintDescription(),
          image: getOldPaperCanvas().toDataURL("image/png"),
        });
        closePaper();
        controls()?.unlock();
        setHintBoxOpen(true);
        return;
      }
      if (isHintBoxOpen()) {
        setHintBoxOpen(false);
        controls()?.lock();
        return;
      }
      if (hintCount > 0) {
        controls()?.unlock();
        setHintBoxOpen(true);
        return;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "KeyP" && isPlainPress(event)) {
        if (!isSettingsOpen) controls()?.unlock();
        setIsSettingsOpen(!isSettingsOpen);
        return;
      }
      if (isSettingsOpen) {
        if (event.code === "Escape") setIsSettingsOpen(false);
        return;
      }
      if (event.code === "KeyI" && isPlainPress(event)) {
        if (!isInventoryOpen && inventory.hand()) {
          inventory.stow();
          return;
        }
        if (isInventoryOpen) controls()?.lock();
        else controls()?.unlock();
        setIsInventoryOpen(!isInventoryOpen);
        return;
      }
      if (isInventoryOpen) {
        if (event.code === "Escape") setIsInventoryOpen(false);
        return;
      }
      if (event.code === "KeyT" && !isLocked) controls()?.lock();
      if (event.code === "KeyH" && isPlainPress(event)) {
        handleHintKey();
        return;
      }
      if (isHintBoxOpen()) {
        if (event.code === "Escape") {
          setHintBoxOpen(false);
          controls()?.lock();
        }
        return;
      }
      // 시점 전환은 카메라 회전을 만지지 않고 캐릭터 표시만 바꾼다. 수식키가 눌린 V 는 편집기의 붙여넣기(⌘V/Ctrl+V)다.
      const isPlainV = event.code === "KeyV" && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (ALLOW_VIEW_TOGGLE && isPlainV) toggleViewMode();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    controlsRef,
    isLocked,
    isSettingsOpen,
    setIsSettingsOpen,
    isInventoryOpen,
    setIsInventoryOpen,
    hintCount,
    toggleViewMode,
  ]);
}
