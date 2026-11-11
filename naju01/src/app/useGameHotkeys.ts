/**
 * 나주 전역 단축키 — 창을 여닫기만 한다. 마우스 잠금은 App 이 창 상태를 보고 pointerHold 로 다룬다
 * (창이 열리면 풀고, 닫히면 열기 전에 조작 중이었을 때만 다시 잠근다 — ESC · 단추 · 배경 클릭 어느 길로 닫아도 같다).
 *   [P] 설정 · [I] 소지품(손에 든 것이 있으면 그것을 넣는다) · [T] 시작 · [H] 힌트함 · [V] 시점 · [Esc] 닫기
 */
import { useEffect, type RefObject } from "react";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import { addHint } from "@/game/hintBox";
import { isBlockedByPauseMenu } from "@/game/pauseMenuState";

import { ending } from "../ending/endingState";
import { isHintBoxOpen, setHintBoxOpen } from "../puzzles/hintBoxView";
import { inventory } from "../puzzles/inventory";
import { hasPointerHolds } from "../puzzles/pointerHold";
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
        setHintBoxOpen(true);
        return;
      }
      if (isHintBoxOpen()) {
        setHintBoxOpen(false);
        return;
      }
      if (hintCount > 0) {
        setHintBoxOpen(true);
        return;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // 멈춤 메뉴가 떠 있으면 T(계속하기) · P(설정)만(나주입장 08회차 Codex)
      if (isBlockedByPauseMenu(event.code)) return;
      // 엔딩(끝 연출 · 필름 · 클리어 화면) 동안은 게임 단축키를 쓰지 않는다(나주엔딩 01회차 Codex)
      if (ending.phase() !== "off") return;
      if (event.code === "KeyP" && isPlainPress(event)) {
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
        setIsInventoryOpen(!isInventoryOpen);
        return;
      }
      if (isInventoryOpen) {
        if (event.code === "Escape") setIsInventoryOpen(false);
        return;
      }
      // 종이 · 게이지처럼 일부러 풀어 둔 동안은 잠그지 않는다 — 잠기면 ESC 가 다시 브라우저로 간다
      if (event.code === "KeyT" && !isLocked && !hasPointerHolds()) controls()?.lock();
      if (event.code === "KeyH" && isPlainPress(event)) {
        handleHintKey();
        return;
      }
      if (isHintBoxOpen()) {
        if (event.code === "Escape") setHintBoxOpen(false);
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
