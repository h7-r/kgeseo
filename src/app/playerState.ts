import * as THREE from "three";

import { EYE } from "@/engine/movement/constants";
import type { AvatarPlayerLink } from "@/naju";

/** 왼손·오른손을 번갈아 낸다. 이름은 아바타 모션 클립 이름이다. */
export type PunchMotion = "Punch_Jab" | "Punch_Cross";

/** 이동·손붙이기·아바타가 함께 쓰는 플레이어 상자. App 이 하나 만들어 씬에 내려보낸다. */
export interface PlayerState extends AvatarPlayerLink {
  attackSerial: number;
  attackMotion: PunchMotion;
}

/**
 * 첫 값만 채운다. position 은 매 프레임 이동이 덮어쓰므로 실제 시작 자리는 Canvas 의 camera 다.
 */
export function createPlayerState(): PlayerState {
  return {
    position: new THREE.Vector3(-25.5, EYE, 0),
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
