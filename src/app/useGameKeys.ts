import { useEffect } from "react";

import { isPointerActive, isTouchMode } from "@/engine/input";
import { gameSetTimeout } from "@/engine/input/gameClock";
import { startReach } from "@/engine/playerView";
import { addHint, flashHints } from "@/game/hintBox";
import { isTypingTarget, OVERLAY_LAYERS, type OverlayLayerName } from "@/game/overlayLayer";
import { isBlockedByPauseMenu } from "@/game/pauseMenuState";
import {
  acceptHintOffer,
  dismissHintOffer,
  isHintOffering,
  isRoamHintOffering,
  noteValveAnswer,
} from "@/game/valveHelp";
import { dropChair, getDraggedChair, runAimedInteraction } from "@/lobby/interactions";
import { getLatestPlacement } from "@/lobby/placement";
import { dropCoin, getHeldCoin } from "@/props/coinState";
import {
  getLockState,
  leaveLockControl,
  leaveLockControlIf,
  selectLockRow,
  submitLockAnswer,
  tryLockAnswer,
  turnLockDigit,
  type LockControl,
} from "@/props/combinationLockState";
import { discardDrink, getHeldDrink, interactWithHeldDrink } from "@/props/drinkState";
import { rattleHinge } from "@/props/hingeState";
import { OPENING_MOTION } from "@/props/padlock/openingMotion";
import { isCutscenePlaying } from "@/props/vendingPushState";
import { dropHintPaper, getFootSpot, storeHintPaper, VALVE_HINT } from "@/props/hintPaperState";
import { getHintPaperImageUrl } from "@/station/hands/hintPaperTexture";
import { chairDragState } from "@/station/headquarters/chairDragState";
import { NEAR_TARGET, type NearTarget } from "@/station/layout/passage";
import { isHologramAimed } from "@/trainInterior/hologramAim";

import type { PointerLockRef } from "./pointerLock";
import { cancelResume, isResumePending, resumePlay } from "./pointerResume";
import { IS_INPUT_ALWAYS_ON } from "./runtimeFlags";
import { tryPlaceHeldItem } from "./useSceneTransition";

// 풀린 자물쇠가 빠져 바닥까지 떨어지는 것을 다 보여 준 뒤 카메라를 되돌린다. 몸짓 길이에 묶어 둬야 어긋나지 않는다.
const UNLOCK_SHOW_MS = OPENING_MOTION.duration * 1000 + 300;

interface GameKeysOptions {
  controlsRef: PointerLockRef;
  near: NearTarget;
  isPointerLocked: boolean;
  isTrain: boolean;
  openLayer: OverlayLayerName | null;
  openWindow: (layer: OverlayLayerName) => void;
  closeWindow: () => void;
  lockControl: LockControl | null;
  boardTrain: () => void;
  leaveTrain: () => void;
  toggleThirdPerson: () => void;
}

/** 정답 뒤 나가기를 이미 걸어 둔 자물쇠 — 풀린 뒤 Enter 를 또 눌러도 타이머가 겹치지 않게(12회차 Codex) */
const leavingAfterUnlock = new Set<string>();
function leaveAfterUnlock(id: string) {
  if (leavingAfterUnlock.has(id)) return;
  leavingAfterUnlock.add(id);
  gameSetTimeout(() => {
    leavingAfterUnlock.delete(id);
    leaveLockControlIf(id);
  }, UNLOCK_SHOW_MS);
}

/** 자물쇠를 만지는 동안은 키를 여기서 다 먹는다. 화살표와 WASD 를 둘 다 받는다(걸음은 어차피 멈춰 있다). */
function handleLockKey(code: string, id: string) {
  // 「추가 힌트를 받으시겠습니까?」를 묻는 동안은 예(Y) · 아니요(N)만 — 다이얼은 안 돈다(12회차)
  if (isHintOffering()) {
    if (code === "KeyY") acceptHintOffer();
    else if (code === "KeyN") dismissHintOffer();
    return;
  }
  if (code === "ArrowLeft" || code === "KeyA") selectLockRow(id, -1);
  else if (code === "ArrowRight" || code === "KeyD") selectLockRow(id, 1);
  else if (code === "ArrowUp" || code === "KeyW") turnLockDigit(id, 1);
  else if (code === "ArrowDown" || code === "KeyS") turnLockDigit(id, -1);
  else if (code === "KeyE" || code === "Enter") {
    // 맞으면 풀리고 나간다. 틀리면 덜컹 — "아니다"를 몸으로 알려 준다.
    // 밸브 자물쇠 막힘 힌트(valveHelp)는 「틀렸다」는 판정만 센다 — 통신 실패 자체는 안 센다. 같은 답 연달아는 한 번(낸 순간의 글자로 가린다)
    const digits = [...(getLockState(id)?.digits ?? [])];
    const answer = digits.join(",");
    submitLockAnswer(id)
      .then((isCorrect) => {
        if (typeof isCorrect === "boolean") noteValveAnswer(id, isCorrect, answer);
        // 늦게 온 판정이 그사이 ESC 로 나갔다가 새로 연 다른 자물쇠 조작을 끝내지 않게 — 그 자물쇠일 때만 나간다
        if (isCorrect === true) leaveAfterUnlock(id);
        else if (isCorrect === false) rattleHinge(id);
      })
      .catch((error: unknown) => {
        // 백엔드 없이 프론트만 켜면 요청이 실패해 튜토리얼 자물쇠가 영영 안 열린다 — 서버에 못 닿았을 때만 로컬 판정.
        console.warn("[Play Session] 자물쇠 판정 실패 — 로컬 판정으로 대신한다", error);
        const isCorrect = tryLockAnswer(id, digits); // 낸 순간의 글자로(그사이 돌린 다이얼 말고)
        noteValveAnswer(id, isCorrect, answer);
        if (isCorrect) leaveAfterUnlock(id);
        else rattleHinge(id);
      });
  }
}

/** [E] — 순서는 화면 안내문과 같아야 한다: 끄는 의자 → 든 음료·쪽지 → 겨냥한 것 → 동전 → 놓기 → 문 */
function handleUse(near: NearTarget, boardTrain: () => void, leaveTrain: () => void) {
  // 기차 출구 앞에서는 내리기가 먼저 — 음료 · 쪽지 · 동전을 든 채 타면 [E] 가 그쪽에 걸려 못 내린다고 여겼다(미르 플레이 시험 11/8)
  if (near === NEAR_TARGET.trainExit || near === NEAR_TARGET.trainExitDoor) {
    leaveTrain();
    return;
  }
  // 끌던 의자가 화면 밖으로 나가 조준이 안 될 수 있어 조준보다 먼저 본다.
  if (getDraggedChair()) {
    dropChair(chairDragState.x, chairDragState.z);
    return;
  }
  // 버튼·투입구를 건드리지 않게 겨냥보다 먼저.
  const drink = getHeldDrink();
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
  if (runAimedInteraction()) return;
  // 투입구가 아닌 곳에서 동전 → 겨냥한 바닥 자리에 내려놓는다(유효한 자리일 때만).
  if (getHeldCoin()) {
    const spot = getLatestPlacement();
    if (spot?.ok && dropCoin([spot.x, spot.y, spot.z])) return;
  }
  if (tryPlaceHeldItem()) return;
  // 문 안으로 걸어 들어가도 타지만 [E] 로도 탄다.
  if (near === NEAR_TARGET.train) boardTrain();
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
    const toggleWindow = (layer: OverlayLayerName) => {
      if (openLayer === layer) closeWindow();
      else if (!openLayer) openWindow(layer);
    };
    const isLockActive = lockControl?.phase === "active";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const { code } = event;
      // 멈춤 메뉴가 떠 있으면 T(계속하기) · P(설정)만 — V 로 시점이 바뀌거나 I · H 로 창이 겹쳐 뜨지 않게(나주입장 08회차 Codex)
      if (isBlockedByPauseMenu(code)) return;

      // 맨 위 하나만 닫는다(CMN-035): 창 → 추가 힌트 묻기(= 아니요) → 자물쇠(게임 화면으로 돌아옴, 12회차) → 그다음 ESC 는
      // 브라우저가 잠금을 풀어 커서가 밖으로. 자물쇠 · 창 동안은 페이지가 잠금을 풀어 두어 ESC 가 키로 들어온다.
      // 자물쇠에서 막 나와 다시 잠그는 중에 ESC 가 또 오면 「밖으로」를 고른 것 — 그 잠금을 거둔다
      if (code === "Escape") {
        // 누르고 있어 자동 반복된 ESC 는 받지 않는다 — 멈춤 메뉴를 ESC 로 닫자마자 반복분이 「밖으로」를 골라 도로 멈췄다(18회차 Codex)
        if (event.repeat) return;
        if (openLayer) closeWindow();
        else if (isLockActive && isHintOffering()) dismissHintOffer();
        else if (isLockActive) leaveLockControl();
        else cancelResume();
        return;
      }
      if (code === "KeyI") {
        toggleWindow(OVERLAY_LAYERS.inventory);
        return;
      }
      if (code === "KeyP") {
        toggleWindow(OVERLAY_LAYERS.settings);
        return;
      }
      if (code === "KeyH") {
        // 쪽지를 들고 있으면 먼저 적어 넣는다. 창에서 「보관」을 따로 찾게 하면 손이 두 번 간다.
        if (getHeldDrink()?.kind === "paper") {
          addHint({ ...VALVE_HINT, image: getHintPaperImageUrl() });
          storeHintPaper();
          discardDrink();
          flashHints(); // 왼쪽 표시가 한 번 밝아진다 — "저기에 적혔다"
          openWindow(OVERLAY_LAYERS.hint);
          return;
        }
        if (openLayer === OVERLAY_LAYERS.hint) closeWindow();
        else if (!openLayer) {
          flashHints();
          openWindow(OVERLAY_LAYERS.hint);
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
      // 자물쇠 밖에서 「추가 힌트를 확인하시겠습니까?」를 묻는 중 — 예(Y) · 아니요(N)만 가로채고 걷기 등은 그대로(미르 11/10).
      // PC 는 마우스가 잠겨 있어 카드 단추를 못 누르므로 키로 고른다
      if (!lockControl && isRoamHintOffering() && (code === "KeyY" || code === "KeyN")) {
        if (code === "KeyY") acceptHintOffer();
        else dismissHintOffer();
        return;
      }
      // 연출이 화면을 돌리는 동안(전류 따라가기 · 배전반 알림)은 만지기 · 시점 전환을 받지 않는다 — 겨냥이 비기 전 E 가
      // 엉뚱한 것에 걸리거나 V 로 카메라가 바뀌면 연출이 깨진다(10회차 Codex)
      if ((code === "KeyE" || code === "KeyV") && isCutscenePlaying()) return;
      if (code === "KeyV" && !isTrain) {
        toggleThirdPerson();
        return;
      }
      // 클릭 대신 T 로 잠근다 — 그래야 Leva 를 자유롭게 만진다. ESC 직후라 크롬이 거절하는 동안이면 풀리는 대로 잠근다(pointerResume)
      if (code === "KeyT" && !isPointerLocked) {
        resumePlay();
        return;
      }
      // 안내판은 문 가까이에도 떠 있어 내리기보다 먼저 묻는다. 잠금이 풀린 채 마우스로 겨눠도 열린다.
      if (code === "KeyE" && isTrain && isHologramAimed()) {
        if (!event.repeat) openWindow(OVERLAY_LAYERS.destination);
        return;
      }
      // 게임으로 돌아가는 중(ESC 직후 잠금을 기다림)에도 조작은 받는다 — 화면은 이미 게임이다
      if (code !== "KeyE" || !(isPointerLocked || isResumePending() || IS_INPUT_ALWAYS_ON)) return;
      // 무엇을 만지든 팔이 한 번 나간다. 여기 한 곳에 걸어야 아래 갈래를 하나도 빠뜨리지 않는다.
      if (!event.repeat) startReach();
      handleUse(near, boardTrain, leaveTrain);
    };
    // 안내판 클릭. 잠금 중엔 이벤트가 캔버스를 감싼 틀로 오고, 풀려 있으면 화면 창 클릭을 걸러야 한다.
    const handlePointerDown = (event: PointerEvent) => {
      // 터치에서는 이 직접 클릭 경로를 쓰지 않는다 — 스틱 · 시점 · 단추를 누를 때마다 안내판이 열린다. 상황 단추(E)로 연다.
      if (isTouchMode()) return;
      if (event.button !== 0 || !isTrain || openLayer || !isHologramAimed()) return;
      if (!isPointerActive() && !(event.target instanceof HTMLCanvasElement)) return;
      openWindow(OVERLAY_LAYERS.destination);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
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
