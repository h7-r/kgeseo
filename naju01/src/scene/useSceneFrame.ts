import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

import type { PresentedControls } from "../app/presentation";
import type { MovementReport } from "../movement/useTerrainMovement";
import type { CollapseSequence } from "../story/blockerCollapse";
import { computeWaterDistortion } from "../story/distortion";
import { setGrainStrength } from "../terrain/groundGrain";
import type { BakedTerrain } from "../terrain/useBakedTerrain";
import type { RippleHandle } from "../world/waterRipples";
import type { CollapseState } from "./useBlockerCollapse";
import type { RiverShapes } from "./useWorldLayers";

/** 걷기 훅이 매 프레임 갈아 끼우는 보고에 씬이 렌더 통계를 덧붙인다(계기판이 읽는다). */
export interface NajuSceneReport extends MovementReport {
  collapseStage?: string | null;
  triangles?: number;
  drawCalls?: number;
  terrainSource?: string;
  fps?: number;
  frameMs?: number;
  worstFrameMs?: number;
}

/** 카메라 FOV 와 렌더 통계 리셋 방식을 맞춘다. */
export function useRendererSetup(fov: number) {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [camera, fov]);

  // useFrame 은 렌더 전에 돈다. 자동 리셋이면 그 직후 값이 지워져 계기판에 0 만 찍힌다 — 직접 리셋한다.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  return { camera, gl, scene };
}

interface SceneFrameOptions {
  controls: PresentedControls;
  camera: THREE.Camera;
  gl: THREE.WebGLRenderer;
  reportRef: RefObject<NajuSceneReport | null>;
  collapseRef: RefObject<CollapseSequence | null>;
  collapseNoticeRef: RefObject<string>;
  setCollapse: Dispatch<SetStateAction<CollapseState | null>>;
  skyRef: RefObject<THREE.Mesh | null>;
  cloudRef: RefObject<THREE.Mesh | null>;
  river: RiverShapes;
  waterShift: number;
  rippleHandle: RefObject<RippleHandle | null>;
  bakedTerrainStatus: BakedTerrain["status"];
}

/**
 * 씬의 주 프레임 — 무너짐 연출, 하늘 따라가기, 물결, 계기판 보고.
 * 반드시 useTerrainMovement 뒤에 불러야 한다 — 그 훅이 매 프레임 reportRef.current 를 갈아끼운다.
 */
export function useSceneFrame({
  controls,
  camera,
  gl,
  reportRef,
  collapseRef,
  collapseNoticeRef,
  setCollapse,
  skyRef,
  cloudRef,
  river,
  waterShift,
  rippleHandle,
  bakedTerrainStatus,
}: SceneFrameOptions) {
  // 프레임 시간 — 평균 60 이어도 가끔 120 ms 가 끼면 끊겨 보인다. 최근 120 프레임의 평균과 가장 느린 프레임을 같이 낸다.
  const frameTimes = useRef(new Float32Array(120));
  const frameSlot = useRef(0);
  const frameCount = useRef(0);

  useFrame((state, dt) => {
    // 헤드리스(SwiftShader)는 한 프레임이 1 초를 넘는다. 5 초 넘는 것(탭이 잠들었다 깬 것)만 버린다.
    if (dt > 0.0005 && dt < 5) {
      frameTimes.current[frameSlot.current] = dt;
      frameSlot.current = (frameSlot.current + 1) % frameTimes.current.length;
      frameCount.current = Math.min(frameCount.current + 1, frameTimes.current.length);
    }
    // 무너뜨리기 연출이 카메라를 직접 돌린다 — 걷기 훅 뒤라야 이번 프레임 값이 안 지워진다.
    const sequence = collapseRef.current;
    if (sequence && !sequence.isDone) {
      sequence.tick(Math.min(0.05, dt), camera); // 창을 되살릴 때 dt 가 튀면 한 번에 끝나 버린다
      setCollapse((v) =>
        v && v.code === sequence.code && v.progress === sequence.progress
          ? v
          : { code: sequence.code, progress: sequence.progress },
      );
    }
    // 하늘돔·구름은 카메라를 따라다닌다 — 시차가 0 이어야 '아주 멀리'로 읽힌다.
    if (skyRef.current) skyRef.current.position.copy(camera.position);
    if (cloudRef.current) cloudRef.current.position.copy(camera.position);
    // 물결은 움직여야 물로 읽힌다
    if (river) {
      const shift = waterShift ? computeWaterDistortion(waterShift) : null;
      river.surface.update(state.clock.elapsedTime * controls.waveSpeed, shift);
      setGrainStrength(controls.groundGrain, controls.groundRockGrain);
      // 잔결도 같은 어긋남을 받아야 위화감이 반만 오지 않는다
      rippleHandle.current?.update(state.clock.elapsedTime * controls.waveSpeed, shift, controls.waterRipple);
    }
    const report = reportRef.current;
    if (report) {
      report.collapseStage = collapseNoticeRef.current;
      report.triangles = gl.info.render.triangles;
      // 지금 보는 땅이 어느 쪽인지 계기판에 박아 둔다 — 「차이가 미미하다」와 「안 바뀌었다」를 가린다.
      report.terrainSource = !controls.useBlenderTerrain
        ? "옛(코드)"
        : bakedTerrainStatus === "ready"
          ? "새(블렌더)"
          : bakedTerrainStatus === "loading"
            ? "새 — 읽는 중…"
            : "옛(코드) ← 새 지형 읽기 실패";
      report.drawCalls = gl.info.render.calls;
      const n = frameCount.current;
      if (n > 4) {
        let sum = 0;
        let max = 0;
        for (let i = 0; i < n; i++) {
          const v = frameTimes.current[i];
          sum += v;
          if (v > max) max = v;
        }
        report.fps = n / sum;
        report.frameMs = (sum / n) * 1000;
        report.worstFrameMs = max * 1000;
      }
    }
    gl.info.reset();
  });
}
