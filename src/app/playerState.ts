import { useEffect, type RefObject } from "react";
import * as THREE from "three";

import { isTouchMode } from "@/engine/input";
import { EYE_HEIGHT } from "@/engine/movement/constants";
import type { AvatarPlayerLink } from "@/naju";

import { IS_INPUT_ALWAYS_ON } from "./runtimeFlags";

/** 왼손·오른손을 번갈아 낸다. 이름은 아바타 모션 클립 이름이다. */
type PunchMotion = "Punch_Jab" | "Punch_Cross";

/** 이동·손붙이기·아바타가 함께 쓰는 플레이어 상자. App 이 하나 만들어 씬에 내려보낸다. */
interface PlayerState extends AvatarPlayerLink {
  attackSerial: number;
  attackMotion: PunchMotion;
}

/** 첫 값만 채운다. position 은 매 프레임 이동이 덮어쓰므로 실제 시작 자리는 Canvas 의 camera 다. */
export function createPlayerState(): PlayerState {
  return {
    position: new THREE.Vector3(-25.5, EYE_HEIGHT, 0),
    footY: 0,
    groundY: 0,
    facing: Math.PI,
    moving: false,
    running: false,
    // 이동이 첫 프레임에 적는다. 아바타는 없으면 0 으로 읽는다.
    speed: 0,
    crouching: false,
    grounded: true,
    jumping: false,
    verticalVelocity: 0,
    attackSerial: 0,
    attackMotion: "Punch_Jab",
  };
}

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
      // 터치 모드에서는 손가락이 만든 호환 mouse 이벤트로 주먹이 나가지 않게 막는다(로비 주먹 단추는 따로)
      if (isTouchMode()) return;
      if (event.button !== 0 || !(isPointerLocked || IS_INPUT_ALWAYS_ON) || !isThirdPerson || isTrain || isWindowOpen)
        return;
      const player = playerRef.current;
      // 주먹은 제자리 동작이다 — 걷거나 뛰는 중에 내면 몸만 빙판처럼 미끄러진다(11/11 플레이테스트)
      if (player.moving || !player.grounded) return;
      player.attackMotion = nextPunch;
      player.attackSerial += 1;
      nextPunch = nextPunch === "Punch_Jab" ? "Punch_Cross" : "Punch_Jab";
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [playerRef, isPointerLocked, isThirdPerson, isTrain, isWindowOpen]);
}
