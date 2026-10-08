import { useEffect } from "react";

import { startReach } from "@/engine/playerView";
import { addHint, flashHints } from "@/game/hintBox";
import { isTypingTarget, LAYERS, type Layer } from "@/game/overlayLayer";
import { dropChair, draggedChair, runAimed } from "@/lobby/interactions";
import { latestPlacement } from "@/lobby/placement";
import { dropCoin, heldCoin } from "@/props/coinState";
import {
  leaveLockControl,
  selectLockRow,
  submitLockAnswer,
  tryLockAnswer,
  turnLockDigit,
  type LockControl,
} from "@/props/combinationLock";
import { discardDrink, heldDrink, interactWithHeldDrink } from "@/props/drinkState";
import { rattle } from "@/props/hingeState";
import { dropHintPaper, getFootSpot, storeHintPaper, VALVE_HINT } from "@/props/hintPaperState";
import { hintPaperImage } from "@/station/hands/hintPaperTexture";
import { chairDragState } from "@/station/office/chairDragState";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";

import type { PointerLockRef } from "./pointerLock";
import { IS_INPUT_ALWAYS_ON } from "./runtimeFlags";
import { tryPlaceHeld } from "./useSceneTransition";

// 풀린 자물쇠가 열리는 모습을 보여 준 뒤 카메라를 되돌린다.
const UNLOCK_SHOW_MS = 1500;

interface GameKeysOptions {
  controlsRef: PointerLockRef;
  near: NearTarget;
  isPointerLocked: boolean;
  isTrain: boolean;
  openLayer: Layer | null;
  openWindow: (layer: Layer) => void;
  closeWindow: () => void;
  lockControl: LockControl | null;
  boardTrain: () => void;
  leaveTrain: () => void;
  toggleThirdPerson: () => void;
}

/** 자물쇠를 만지는 동안은 키를 여기서 다 먹는다. 화살표와 WASD 를 둘 다 받는다(걸음은 어차피 멈춰 있다). */
function handleLockKey(code: string, id: string) {
  if (code === "ArrowLeft" || code === "KeyA") selectLockRow(id, -1);
  else if (code === "ArrowRight" || code === "KeyD") selectLockRow(id, 1);
  else if (code === "ArrowUp" || code === "KeyW") turnLockDigit(id, 1);
  else if (code === "ArrowDown" || code === "KeyS") turnLockDigit(id, -1);
  else if (code === "KeyE" || code === "Enter") {
    // 맞으면 풀리고 나간다. 틀리면 덜컹 — "아니다"를 몸으로 알려 준다.
    submitLockAnswer(id)
      .then((isCorrect) => {
        if (isCorrect === true) setTimeout(() => leaveLockControl(), UNLOCK_SHOW_MS);
        else if (isCorrect === false) rattle(id);
      })
      .catch((error: unknown) => {
        // 백엔드 없이 프론트만 켜면 요청이 실패해 튜토리얼 자물쇠가 영영 안 열린다 — 서버에 못 닿았을 때만 로컬 판정.
        console.warn("[Play Session] 자물쇠 판정 실패 — 로컬 판정으로 대신한다", error);
        if (tryLockAnswer(id)) setTimeout(() => leaveLockControl(), UNLOCK_SHOW_MS);
        else rattle(id);
      });
  }
}

/** [E] — 순서는 화면 안내문과 같아야 한다: 끄는 의자 → 든 음료·쪽지 → 겨냥한 것 → 동전 → 놓기 → 문 */
function handleUse(near: NearTarget, boardTrain: () => void, leaveTrain: () => void) {
  // 끌던 의자가 화면 밖으로 나가 조준이 안 될 수 있어 조준보다 먼저 본다.
  if (draggedChair()) {
    dropChair(chairDragState.x, chairDragState.z);
    return;
  }
  // 버튼·투입구를 건드리지 않게 겨냥보다 먼저.
  const drink = heldDrink();
  if (drink) {
    // 쪽지는 버린다. 발 앞에 떨어져 다시 주울 수 있다(GRD-01). 보관은 [H].
    if (drink.kind === "paper") {
      dropHintPaper(getFootSpot());
      discardDrink();
      return;
    }
    interactWithHeldDrink();
    return;
  }
  if (runAimed()) return;
  // 투입구가 아닌 곳에서 동전 → 겨냥한 바닥 자리에 내려놓는다(유효한 자리일 때만).
  if (heldCoin()) {
    const spot = latestPlacement();
    if (spot?.ok && dropCoin([spot.x, spot.y, spot.z])) return;
  }
  if (tryPlaceHeld()) return;
  // 문 안으로 걸어 들어가도 타지만 [E] 로도 탄다.
  if (near === NEAR_TARGET.train) boardTrain();
  else if (near === NEAR_TARGET.trainExit) leaveTrain();
}

/**
 * 게임 키보드. 창(I·P·H·ESC) > 자물쇠 > 시점(V·T) > [E] 순으로 먹는다.
 * I·P·H 는 화면 창이라 마우스 잠금(T)과 무관하게 연다 — 페이지를 열자마자 I 를 누른 사람도 열려야 한다.
 */
export function useGameKeys({
  controlsRef,
  near,
  isPointerLocked,
  isTrain,
  openLayer,
  openWindow,
  closeWindow,
  lockControl,
  boardTrain,
  leaveTrain,
  toggleThirdPerson,
}: GameKeysOptions) {
  useEffect(() => {
    // 열려 있으면 닫고, 아무 창도 없을 때만 연다(다른 창 위로 겹쳐 열지 않는다).
    const toggleWindow = (layer: Layer) => {
      if (openLayer === layer) closeWindow();
      else if (!openLayer) openWindow(layer);
    };
    const isLockActive = lockControl?.phase === "active";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const { code } = event;

      // 열린 창부터 닫는다(CMN-035). 브라우저가 ESC 로 잠금을 먼저 푸는 건 막을 수 없지만 창이 열려 있으면 이미 풀려 있다.
      if (code === "Escape") {
        if (openLayer) closeWindow();
        else if (isLockActive) leaveLockControl();
        return;
      }
      if (code === "KeyI") {
        toggleWindow(LAYERS.inventory);
        return;
      }
      if (code === "KeyP") {
        toggleWindow(LAYERS.settings);
        return;
      }
      if (code === "KeyH") {
        // 쪽지를 들고 있으면 먼저 적어 넣는다. 창에서 「보관」을 따로 찾게 하면 손이 두 번 간다.
        if (heldDrink()?.kind === "paper") {
          addHint({ ...VALVE_HINT, image: hintPaperImage() });
          storeHintPaper();
          discardDrink();
          flashHints(); // 왼쪽 표시가 한 번 밝아진다 — "저기에 적혔다"
          openWindow(LAYERS.hint);
          return;
        }
        if (openLayer === LAYERS.hint) closeWindow();
        else if (!openLayer) {
          flashHints();
          openWindow(LAYERS.hint);
        }
        return;
      }

      // 창이 열려 있으면 게임 조작은 전부 막는다
      if (openLayer) return;

      // 자물쇠 중엔 마우스 잠금이 풀려 있어 아래 잠금 검사에 걸리므로 그보다 앞에 둔다.
      if (lockControl && isLockActive) {
        handleLockKey(code, lockControl.id);
        return;
      }
      if (code === "KeyV" && !isTrain) {
        toggleThirdPerson();
        return;
      }
      // 클릭 대신 T 로 잠근다 — 그래야 Leva 를 자유롭게 만진다.
      if (code === "KeyT" && !isPointerLocked) {
        controlsRef.current?.lock();
        return;
      }
      if (code !== "KeyE" || !(isPointerLocked || IS_INPUT_ALWAYS_ON)) return;
      // 무엇을 만지든 팔이 한 번 나간다. 여기 한 곳에 걸어야 아래 갈래를 하나도 빠뜨리지 않는다.
      if (!event.repeat) startReach();
      handleUse(near, boardTrain, leaveTrain);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    controlsRef,
    near,
    isPointerLocked,
    isTrain,
    openLayer,
    openWindow,
    closeWindow,
    lockControl,
    boardTrain,
    leaveTrain,
    toggleThirdPerson,
  ]);
}
