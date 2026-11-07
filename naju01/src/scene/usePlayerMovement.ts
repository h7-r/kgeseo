import { useTouchMode } from "@/engine/input/touchMode";
import { useEffect, useMemo, useState, type RefObject } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";

import type { PresentedControls } from "../app/presentation";
import { buildCameraOccluders, buildPropColliders } from "../movement/propColliders";
import { useSolidField } from "../movement/solidField";
import { gateBlockedAt } from "../movement/stageGates";
import { MOVEMENT_CONSTANTS, useTerrainMovement } from "../movement/useTerrainMovement";
import {
  TOUCH_UNDERWATER_SPEED,
  UNDERWATER_SPEED,
  cave,
  registerTeleporter,
  useIsUnderwater,
  withCave,
} from "../puzzles/cave/caveState";
import type { InstanceGroup } from "../placement/instanceGroups";
import { VIEWPOINTS } from "../plan/sitePlan";
import { IS_REVIEW_REQUESTED } from "../review/ReviewBridge";
import { savedNajuStart } from "../save/najuSaveData";
import type { ConnectorRamp } from "../terrain/connectorRamp";
import type { NajuSceneReport } from "./useSceneFrame";
import type { Terrain } from "./useTerrainLayers";

interface PlayerMovementOptions {
  controls: PresentedControls;
  active: boolean;
  isEditing: boolean;
  isOverview: boolean;
  isThirdPerson: boolean;
  terrain: Terrain;
  instanceGroups: InstanceGroup[];
  ramp: ConnectorRamp | null;
  reportRef: RefObject<NajuSceneReport | null>;
  playerState: RefObject<AvatarLink>;
  /** 검수 카메라가 시점을 잡고 있는 동안 걷기를 멈춘다(review/ReviewBridge.useReviewCameraHold) */
  isReviewHold?: boolean;
}

/** 이동 — 시작은 V1. 편집 중에도 WASD 는 살아 있어야 「보면서 옮기기」가 된다. */
export function usePlayerMovement({
  controls,
  active,
  isEditing,
  isOverview,
  isReviewHold = false,
  isThirdPerson,
  terrain,
  instanceGroups,
  ramp,
  reportRef,
  playerState,
}: PlayerMovementOptions) {
  const propColliders = useMemo(() => buildPropColliders(instanceGroups), [instanceGroups]);
  const cameraOccluders = useMemo(() => buildCameraOccluders(instanceGroups), [instanceGroups]);
  useEffect(() => {
    if (import.meta.env.DEV) exposeDevHook("propColliders", propColliders);
  }, [propColliders]);
  // 강 밑 물굴(puzzles/cave) — 물이 갈라져 있는 동안 그 자리의 바닥·벽은 물굴 것. 물속에서는 살짝 무겁게 걷는다
  const walkable = useMemo(() => withCave(terrain), [terrain]);
  const isUnderwater = useIsUnderwater();
  const isTouch = useTouchMode();
  // 화면의 물건을 구운 충돌 격자 — 다 구워지면 위 소품 충돌 대신 쓰고, 낮은 물건 위로 올라선다
  const solid = useSolidField((x, z) => terrain.groundAt(x, z).y);
  const [savedStart] = useState(savedNajuStart);
  const teleport = useTerrainMovement(active || isEditing, {
    terrain: walkable,
    extraBlockedAt: isEditing ? null : propColliders.blockedAt,
    solid: isEditing ? null : solid,
    gateBlockedAt: isEditing ? null : gateBlockedAt,
    // 이어 하기면 나갔던 자리에서 시작한다. 시선은 NajuSaveBridge 가 맞춘다.
    start: savedStart
      ? [savedStart[0], savedStart[1], undefined]
      : [VIEWPOINTS[0].x, VIEWPOINTS[0].z, VIEWPOINTS[0].heading],
    eyeHeight: controls.eyeHeight,
    walkSpeed: isUnderwater
      ? (controls.walkSpeed ?? MOVEMENT_CONSTANTS.walk) * (isTouch ? TOUCH_UNDERWATER_SPEED : UNDERWATER_SPEED)
      : controls.walkSpeed,
    swim: isUnderwater,
    fallRecovery: controls.fallRecovery,
    // 보고를 읽는 곳은 검수 실행의 ReviewBridge 뿐이다
    reportRef: IS_REVIEW_REQUESTED ? reportRef : null,
    arrowKeysMove: !isEditing, // 편집 중 방향키는 요소를 민다
    isThirdPerson,
    playerRef: playerState,
    // 시작점 뒤 수목 안으로 카메라가 들어가지 않는 거리. 그래도 덤불이 붐에 걸리면 cameraOccludedAt 이 당긴다.
    thirdPersonDistance: 2.8,
    cameraOccludedAt: isEditing ? null : cameraOccluders.occludes,
    // 부감 동안은 걷기를 통째로 멈춘다 — active 만 끄면 중력이 카메라를 땅으로 끌어내린다.
    paused: (isEditing && isOverview) || isReviewHold,
    // 코어 밖은 연결로 위에서만 연다 — 경계를 넓히면 동쪽 어디서나 6.7 m 아래로 떨어진다. 물굴은 강 밑(z 50 너머)이라 같이 연다.
    canLeaveCore: (x: number, z: number) =>
      (cave.isOpen() && cave.contains(x, z)) || (!!controls.allowLeavingCore && !!ramp && ramp.isOn(x, z)),
  });
  // 숨이 다했을 때 · 물살에 실려 나갈 때 물굴이 자리를 옮긴다
  useEffect(() => registerTeleporter(teleport), [teleport]);
  return teleport;
}
