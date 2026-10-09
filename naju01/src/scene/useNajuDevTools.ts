import { useEffect, type RefObject } from "react";
import * as THREE from "three";

import { exposeDevHook } from "@/debug/devHooks";

import type { PresentedControls } from "../app/presentation";
import { applyRealSize, findFirstMesh, parseGlb } from "../loaders/glbImport";
import type { TerrainTeleport } from "../movement/useTerrainMovement";
import { VIEWPOINTS } from "../plan/sitePlan";
import type { CollapseSequence } from "../story/blockerCollapse";
import { applyBakedTerrainTexture } from "../terrain/bakedTerrainTexture";
import type { ConnectorRamp } from "../terrain/connectorRamp";
import { bakeUnderpaint, collectTerrain, computeGroundCellRect, exportTerrainGlb } from "../terrain/terrainAtlas";
import type { Terrain } from "./useTerrainLayers";

const DIGIT_INDEX: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 };

interface NajuDevHookOptions {
  camera: THREE.Camera;
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  terrain: Terrain;
  controls: PresentedControls;
  teleport: RefObject<TerrainTeleport | null>;
  endScene: (sceneNumber: number) => string;
  clearedBlockers: Set<string>;
  collapseRef: RefObject<CollapseSequence | null>;
  ramp: ConnectorRamp | null;
}

/** 개발용 `__game.naju` — 헤드리스 스크린샷·콘솔이 쓴다. teleport 를 쓰므로 useTerrainMovement 뒤여야 한다. */
export function useNajuDevHook({
  camera,
  gl,
  scene,
  terrain,
  controls,
  teleport,
  endScene,
  clearedBlockers,
  collapseRef,
  ramp,
}: NajuDevHookOptions) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("naju", {
      camera,
      gl,
      scene,
      terrain,
      controls,
      teleport,
      THREE,
      // Meshy 에 넘길 지형 한 덩이를 뽑는다(굽는 규칙은 terrainAtlas)
      exportTerrainGlb: (options?: Parameters<typeof exportTerrainGlb>[1]) => exportTerrainGlb(scene, options, gl),
      endScene,
      rampMeasurements: () => ramp?.measurements ?? null,
      clearedBlockers: () => [...clearedBlockers],
      collapseStage: () =>
        collapseRef.current ? (collapseRef.current.isDone ? "끝" : collapseRef.current.stage()) : "없음",
      // 세계 사각형 → 아틀라스 사각형(구역별 굽기에서 도구가 쓴다)
      groundCellRect: computeGroundCellRect,
      zoneList: () => terrain.zones.map((z) => ({ code: z.code, x: z.x, z: z.z })),
      // 밑그림 아틀라스를 캔버스로 — 색 대조용
      underpaint: (size = 2048) => {
        const collected = collectTerrain(scene, { vertexColors: true });
        if (!collected) throw new Error("밑그림을 구울 지형 메시가 없다");
        return bakeUnderpaint(gl, collected.geometry, size);
      },
      assets: { parseGlb, firstMesh: findFirstMesh, fitRealSize: applyRealSize },
      // 도구가 Leva 를 안 거치고 구운 텍스처를 껐다 켠다
      bakedTerrain: (enabled: boolean) => applyBakedTerrainTexture(scene, enabled),
    });
  }, [camera, gl, scene, terrain, controls, teleport, endScene, clearedBlockers, ramp, collapseRef]);
}

/** 개발용 — 숫자키 V1~V3 텔레포트(§4 시야 검증), Shift+숫자 = 그 씬이 끝났다. IME 때문에 e.code 를 쓴다. */
export function useViewpointKeys(
  teleport: RefObject<TerrainTeleport | null>,
  endScene: (sceneNumber: number) => string,
  collapseNoticeRef: RefObject<string>,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const i = DIGIT_INDEX[e.code];
      if (i === undefined) return;
      if (e.shiftKey) {
        collapseNoticeRef.current = endScene(i + 1);
        return;
      }
      if (i > 2 || !teleport.current) return;
      const v = VIEWPOINTS[i];
      teleport.current(v.x, v.z, v.heading);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [teleport, endScene, collapseNoticeRef]);
}
