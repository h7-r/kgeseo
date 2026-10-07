import { useEffect, useMemo } from "react";

import { scaleColor } from "@/engine/color";
import { pickOutline } from "@/engine/leva/savedControls";
import type { OutlineValues } from "@/engine/toon";
import { exposeDevHook } from "@/debug/devHooks";
import { registerSurface, unregisterSurface } from "@/lobby/placement";
import { restoreUnlocked, useLockExists, useLockUnlocked } from "@/props/combinationLock";
import { restoreOpen } from "@/props/hingeState";
import type { WorkLampPuzzleValues } from "@/props/workLampPuzzle/controls";
import { useCorridorPower, useEndDoorReleased, useFullPower } from "@/props/workLampPuzzle/workLampState";
import { corridorDepthBrightness, type CorridorDepthRule } from "@/station/corridor/depthShading";
import { wallCabinetDoorId } from "@/station/corridor/wallCabinetId";
import { PLAY_CONTRACT, usePlayFlag, usePlayStateSource, usePuzzleCompleted } from "@/server/playSession";
import { MIN_X } from "@/station/layout/dimensions";
import { passage } from "@/station/layout/passage";

import type { CorridorValues } from "../controls/corridorControls";

/** 복도 길이 비율(0 = 비상계단 쪽 끝, 1 = 방 쪽 끝) → 세계 z */
export const corridorZ = (corridor: CorridorValues, ratio: number) =>
  corridor.startZ + (corridor.endZ - corridor.startZ) * ratio;

/** 벽함 두 개의 자리. 배전반은 문이 있는 바깥벽(+x 를 봄), 소화전은 맞은편 안쪽벽(-x 를 봄). */
export function wallCabinetSpots(corridor: CorridorValues) {
  return {
    panel: { x: corridor.outerX + corridor.panelDepth / 2 + 0.05, z: corridorZ(corridor, corridor.panelZRatio) },
    hydrant: { x: MIN_X - corridor.hydrantDepth / 2 - 0.05, z: corridorZ(corridor, corridor.hydrantZRatio) },
  };
}

/**
 * 복도 깊이 밝기 — 규칙도 함수도 하나만 만든다. 자리마다 새 함수를 만들면 자식이 「밝기가 바뀌었다」로 보고
 * 지오를 다시 만든다. 작업등 퍼즐 구간 어둠(전원이 들어오면 경계가 −∞ 가 되어 풀린다)도 여기서 섞는다.
 */
export function useCorridorBrightness(corridor: CorridorValues, workLamp: WorkLampPuzzleValues) {
  const hasPower = useCorridorPower();
  const hasFullPower = useFullPower();
  const isEndDoorReleased = useEndDoorReleased();

  // 비상 전원(차단기만 올림)일 때는 퍼즐 쪽 절반만 먼저 밝아진다(halfPowerBoundaryZ)
  const isZoneDark = workLamp.visible && workLamp.startDark && !hasFullPower;
  const depthRule = useMemo<CorridorDepthRule>(
    () => ({
      doorZ: corridor.doorZ,
      falloff: corridor.falloff,
      darkness: corridor.depthDarkness,
      minBrightness: corridor.minBrightness,
      endDarkness: corridor.endDarkness,
      endCurve: corridor.endCurve,
      z0: corridor.startZ,
      darkBoundary: isZoneDark ? workLamp.darkBoundaryZ : -Infinity,
      darkFactor: workLamp.darkFactor,
      brightBoundary: hasPower ? workLamp.halfPowerBoundaryZ : -Infinity,
    }),
    [
      corridor.doorZ,
      corridor.falloff,
      corridor.depthDarkness,
      corridor.minBrightness,
      corridor.endDarkness,
      corridor.endCurve,
      corridor.startZ,
      isZoneDark,
      workLamp.darkBoundaryZ,
      workLamp.darkFactor,
      workLamp.halfPowerBoundaryZ,
      hasPower,
    ],
  );
  const brightnessAt = useMemo(() => (z: number) => corridorDepthBrightness(z, depthRule), [depthRule]);

  // 주름선은 조명을 안 받는 고정색이라 벽이 새까매져도 트레이 살이 회색 격자로 혼자 뜬다 — 어둠을 따라 낮춘다.
  const baseOutline = useMemo(() => pickOutline(corridor), [corridor]);
  const outline = useMemo<OutlineValues>(() => {
    if (!isZoneDark) return baseOutline;
    return { ...baseOutline, creaseColor: scaleColor(baseOutline.creaseColor, hasPower ? 0.55 : 0.18) };
  }, [baseOutline, isZoneDark, hasPower]);

  return { depthRule, brightnessAt, outline, hasPower, hasFullPower, isEndDoorReleased };
}

export type CorridorShading = ReturnType<typeof useCorridorBrightness>;

/**
 * 복도 경계를 이동 계산(useFrame)이 읽는 모듈 상자에 넣고, 복도 바닥을 「놓을 수 있는 면」으로 등록한다.
 * 방 바닥면은 MIN_X 안쪽만 덮어서, 복도 바닥을 따로 등록하지 않으면 동전을 복도에 못 내려놓는다.
 */
export function useCorridorSync(corridor: CorridorValues) {
  const { visible, openness, showBlocker, freeRoam, doorZ, doorWidth, outerX, startZ, endZ } = corridor;
  useEffect(() => {
    passage.set({
      // 막이가 없으면 구멍을 막는 게 없으므로 늘 열림. 막이가 있을 때만 열림 슬라이더(나중엔 퍼즐)가 정한다.
      open: !visible ? 0 : showBlocker ? openness : 1,
      freeRoam,
      doorZ,
      doorWidth,
      corridorMinX: outerX,
      corridorMinZ: startZ,
      corridorMaxZ: endZ,
    });
  }, [visible, openness, showBlocker, freeRoam, doorZ, doorWidth, outerX, startZ, endZ]);

  useEffect(() => {
    // 복도 바닥판이 y=0.01 에 깔려 있다
    registerSurface("corridorFloor", { minX: outerX, maxX: MIN_X, minZ: startZ, maxZ: endZ, top: 0.01 });
    return () => unregisterSurface("corridorFloor");
  }, [outerX, startZ, endZ]);
}

/**
 * 벽함 문 id 와 소화전 잠김. 문·덜컹·자물쇠가 한 이름으로 묶이므로 자리에서 조립한 id 를 모두가 같이 쓴다.
 * 자물쇠 번호까지 구독하면 다이얼을 돌릴 때마다 복도 전체가 다시 그려진다 — 참/거짓만 본다.
 */
export function useWallCabinetDoors(corridor: CorridorValues, isPadlockVisible: boolean) {
  const spots = wallCabinetSpots(corridor);
  const hydrantDoorId = wallCabinetDoorId("hydrant", spots.hydrant.x, spots.hydrant.z);
  const panelDoorId = wallCabinetDoorId("panel", spots.panel.x, spots.panel.z);
  const hasHydrantLock = useLockExists(hydrantDoorId);
  const isHydrantUnlocked = useLockUnlocked(hydrantDoorId);
  // 이어 하기 — 서버에 남은 진행(퍼즐 완료·문 열림)을 소리·연출 없이 월드에 되살린다
  const isServerPuzzleCompleted = usePuzzleCompleted(PLAY_CONTRACT.puzzleId);
  const isServerCabinetOpen = usePlayFlag(PLAY_CONTRACT.unlockedFlag) === true;
  const stateSource = usePlayStateSource();
  useEffect(() => {
    if (stateSource !== "restored") return;
    if (isServerPuzzleCompleted) restoreUnlocked(hydrantDoorId);
    if (isServerCabinetOpen) restoreOpen(hydrantDoorId);
  }, [stateSource, isServerPuzzleCompleted, isServerCabinetOpen, hydrantDoorId]);
  // 자물쇠를 숨겨 놨으면(자리 맞추는 중) 문은 그냥 열린다
  const isHydrantLocked = isPadlockVisible && hasHydrantLock && !isHydrantUnlocked;

  // 시험 스크립트가 문을 여닫으려면 이름을 알아야 한다(자리에서 조립돼 밖에서는 짐작할 수 없다)
  useEffect(() => {
    exposeDevHook("hydrantDoorId", hydrantDoorId);
    exposeDevHook("panelDoorId", panelDoorId);
  }, [hydrantDoorId, panelDoorId]);

  return { hydrantDoorId, isHydrantLocked };
}
