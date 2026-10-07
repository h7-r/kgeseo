import { useEffect, type RefObject } from "react";

import { IS_INPUT_ALWAYS_ON } from "@/app/runtimeFlags";

import type { PlayerState, PunchMotion } from "./playerState";

interface PunchOptions {
  playerRef: RefObject<PlayerState>;
  isPointerLocked: boolean;
  isThirdPerson: boolean;
  isTrain: boolean;
  isWindowOpen: boolean;
}

/** 3인칭에서 왼쪽 클릭 → 잽·크로스를 번갈아. 아바타가 attackSerial 이 바뀐 걸 보고 모션을 튼다. */
export function usePunch({ playerRef, isPointerLocked, isThirdPerson, isTrain, isWindowOpen }: PunchOptions) {
  useEffect(() => {
    let nextPunch: PunchMotion = "Punch_Jab";
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !(isPointerLocked || IS_INPUT_ALWAYS_ON) || !isThirdPerson || isTrain || isWindowOpen)
        return;
      const player = playerRef.current;
      player.attackMotion = nextPunch;
      player.attackSerial += 1;
      nextPunch = nextPunch === "Punch_Jab" ? "Punch_Cross" : "Punch_Jab";
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [playerRef, isPointerLocked, isThirdPerson, isTrain, isWindowOpen]);
}
