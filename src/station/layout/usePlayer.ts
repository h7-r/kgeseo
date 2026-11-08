import { useCallback, useLayoutEffect, useRef } from "react";

import { CROUCH_EYE_HEIGHT, EYE_HEIGHT, INTERACT_DISTANCE, PLAYER_RADIUS } from "@/engine/movement/constants";
import { useMovement, type MovementOptions } from "@/engine/movement/useMovement";

import { isBlockedForPlayer } from "./collision";
import {
  HEADQUARTERS_MAX_X,
  HEADQUARTERS_MAX_Z,
  HEADQUARTERS_MIN_X,
  HEADQUARTERS_MIN_Z,
  HEADQUARTERS_H,
} from "./dimensions";
import { DOOR_ENTER_DISTANCE, DOOR_UNLOCK_DISTANCE, NEAR_TARGET, passage, type NearTarget } from "./passage";
import { doorState, enteredDoor, entryLock, trainDoors } from "./trainDoors";

interface FloorPoint {
  x: number;
  z: number;
}

/** 기차에서 내린 직후 다시 세울 자리. 평소(처음 접속)에는 null. */
export interface ReturnPose {
  start: MovementOptions["start"];
  facing: number;
}

interface UsePlayerOptions {
  active: boolean;
  onNear: (target: NearTarget) => void;
  eye?: number;
  crouchEye?: number;
  returnPose?: ReturnPose | null;
  thirdPerson?: boolean;
  playerRef?: MovementOptions["playerRef"];
  enabled?: boolean;
}

/**
 * 역(본부실·비밀 복도) 전용 이동 규칙. 걷기·점프·앉기는 useMovement 가 맡고 여기서는 이 씬의 규칙만 넘긴다.
 * 경계 — 방과 복도는 구멍 앞에서만 이어진다 / 막힘 — 기둥·가구 / 근처 — 기차 문.
 */
export function usePlayer({
  active,
  onNear,
  eye = EYE_HEIGHT,
  crouchEye = CROUCH_EYE_HEIGHT,
  returnPose,
  thirdPerson = false,
  playerRef = null,
  enabled = true,
}: UsePlayerOptions) {
  const onNearRef = useRef(onNear);
  useLayoutEffect(() => {
    onNearRef.current = onNear;
  });

  const bounds = useCallback((p: FloorPoint) => {
    const pass = passage.get();
    // 통과 창 = 구멍 폭의 절반. 자유이동이면 문 앞인 척해 전부 풀린다.
    const atDoor = pass.freeRoam || (pass.open > 0.8 && Math.abs(p.z - pass.doorZ) < pass.doorWidth / 2);
    const inCorridor = p.x < HEADQUARTERS_MIN_X;
    let minX = HEADQUARTERS_MIN_X + PLAYER_RADIUS;
    let maxX = HEADQUARTERS_MAX_X - PLAYER_RADIUS;
    if (inCorridor || atDoor) minX = pass.corridorMinX + PLAYER_RADIUS;
    if (inCorridor && !atDoor) maxX = HEADQUARTERS_MIN_X - PLAYER_RADIUS;

    const minZ =
      (pass.freeRoam
        ? Math.min(HEADQUARTERS_MIN_Z, pass.corridorMinZ)
        : inCorridor
          ? pass.corridorMinZ
          : HEADQUARTERS_MIN_Z) + PLAYER_RADIUS;
    const maxZ =
      (pass.freeRoam
        ? Math.max(HEADQUARTERS_MAX_Z, pass.corridorMaxZ)
        : inCorridor
          ? pass.corridorMaxZ
          : HEADQUARTERS_MAX_Z) - PLAYER_RADIUS;
    return { minX, maxX, minZ, maxZ };
  }, []);

  const near = useCallback((p: FloorPoint) => {
    let target: NearTarget = NEAR_TARGET.none;
    // 타는 문은 출동 안내가 데려가는 오른쪽 문(발판 있는 문) 하나뿐이다 — 뒤쪽 칸 문(후문)으로 다가가 타는 건 필요 없었다
    // (미르 플레이 시험 11/8, 튜토피드백 01회차). 열리는 문(doorState)도 이 문만.
    const door = trainDoors.rightmost(p.x, p.z);
    doorState.car = door ? door.car : null;
    doorState.distance = door ? door.distance : Infinity;
    if (!door || door.distance > DOOR_UNLOCK_DISTANCE) entryLock.active = false;

    if (door && door.distance < DOOR_ENTER_DISTANCE && !entryLock.active) {
      enteredDoor.car = door.car;
      enteredDoor.position = { x: door.x, z: door.z };
      target = NEAR_TARGET.trainEntrance;
    } else if (door && door.distance < INTERACT_DISTANCE) {
      // 아직 문 앞. [E] 로도 탈 수 있게 남겨 둔다.
      enteredDoor.car = door.car;
      enteredDoor.position = { x: door.x, z: door.z };
      target = NEAR_TARGET.train;
    }
    onNearRef.current(target);
    return target;
  }, []);

  useMovement(active, {
    eyeHeight: eye,
    crouchEyeHeight: crouchEye,
    bounds,
    isBlocked: isBlockedForPlayer,
    nearby: near,
    // 기차에서 돌아올 때만 자리를 옮긴다.
    start: returnPose?.start,
    facing: returnPose?.facing,
    isThirdPerson: thirdPerson,
    playerRef,
    thirdPersonDistance: 2.8,
    ceiling: HEADQUARTERS_H, // 3인칭 카메라가 천장을 뚫지 않게
    enabled,
  });
}
