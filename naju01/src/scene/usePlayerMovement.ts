import { useEffect, useMemo, type RefObject } from "react";

import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";

import type { PresentedControls } from "../app/presentation";
import { buildCameraOccluders, buildPropColliders } from "../movement/propColliders";
import { useTerrainMovement } from "../movement/useTerrainMovement";
import type { InstanceGroup } from "../placement/instanceGroups";
import { VIEWPOINTS } from "../plan/sitePlan";
import type { ConnectorRamp } from "../terrain/connectorRamp";
import type { NajuSceneReport } from "./useSceneFrame";
import type { Terrain } from "./useTerrainLayers";

interface PlayerMovementOptions {
  T: PresentedControls;
  active: boolean;
  isEditing: boolean;
  isOverview: boolean;
  isThirdPerson: boolean;
  terrain: Terrain;
  instanceGroups: InstanceGroup[];
  ramp: ConnectorRamp | null;
  reportRef: RefObject<NajuSceneReport | null>;
  playerState: RefObject<AvatarLink>;
}

/** 이동 — 시작은 V1. 편집 중에도 WASD 는 살아 있어야 「보면서 옮기기」가 된다. */
export function usePlayerMovement({
  T,
  active,
  isEditing,
  isOverview,
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
  return useTerrainMovement(active || isEditing, {
    terrain,
    extraBlockedAt: isEditing ? null : propColliders.blockedAt,
    start: [VIEWPOINTS[0].x, VIEWPOINTS[0].z, VIEWPOINTS[0].heading],
    eyeHeight: T.eyeHeight,
    walkSpeed: T.walkSpeed,
    fallRecovery: T.fallRecovery,
    reportRef,
    arrowKeysMove: !isEditing, // 편집 중 방향키는 요소를 민다
    isThirdPerson,
    playerRef: playerState,
    // 시작점 뒤 수목 안으로 카메라가 들어가지 않는 거리. 그래도 덤불이 붐에 걸리면 cameraOccludedAt 이 당긴다.
    thirdPersonDistance: 2.8,
    cameraOccludedAt: isEditing ? null : cameraOccluders.occludes,
    // 부감 동안은 걷기를 통째로 멈춘다 — active 만 끄면 중력이 카메라를 땅으로 끌어내린다.
    paused: isEditing && isOverview,
    // 코어 밖은 연결로 위에서만 연다 — 경계를 넓히면 동쪽 어디서나 6.7 m 아래로 떨어진다.
    canLeaveCore: T.allowLeavingCore && ramp ? (x: number, z: number) => ramp.isOn(x, z) : null,
  });
}
