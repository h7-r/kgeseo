// 블렌더가 구운 땅 한 벌(GLB + 높이표)을 같이 읽어 씬이 한 번에 갈아끼우게 한다.
// drei useGLTF 는 읽는 동안 suspend 해 씬 전체가 멈추고 실패하면 에러 경계로 튄다.
// 여기서는 실패해도 해석식 지형으로 그냥 돌아야 해서 직접 읽고 상태로 든다.

import { useEffect, useReducer } from "react";
import type * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { findFirstMesh } from "../loaders/glbImport";
import { loadHeightTable, type HeightTable } from "./heightTable";

/**
 * 보이는 땅은 가벼운 판을 쓴다(11/18) — 원본은 320×200 고른 격자 12.8만 면이라 평평한 강변도 비탈만큼 촘촘했다.
 *   가벼운 판은 모양이 같은 만큼만 합친 4.2만 면이다(tools/terrain-lite.mjs — 걷는 땅의 높이 차 최대 3.2 cm). 걷기 · 소품 놓기는 높이표를 읽어 그대로다.
 *   `?terrain=full` 로 원본을 본다(견줘 보기 · 깨지면 이 줄만 되돌린다).
 */
const IS_FULL_TERRAIN =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("terrain") === "full";
const TERRAIN_GLB_URL = IS_FULL_TERRAIN
  ? new URL("../../assets/terrain.glb", import.meta.url).href
  : new URL("../../assets/terrain-lite.glb", import.meta.url).href;

type BakedTerrainStatus = "idle" | "loading" | "ready" | "failed";

export interface BakedTerrain {
  /** 단위는 도면 미터 — 씬에서 scale={UNITS_PER_METER} 로 올린다 */
  geometry: THREE.BufferGeometry | null;
  /** terrain.setHeightTable(heightTable) 에 끼운다 */
  heightTable: HeightTable | null;
  status: BakedTerrainStatus;
}

const IDLE: BakedTerrain = { geometry: null, heightTable: null, status: "idle" };
const LOADING: BakedTerrain = { geometry: null, heightTable: null, status: "loading" };
const FAILED: BakedTerrain = { geometry: null, heightTable: null, status: "failed" };

function loadTerrainGeometry() {
  return new Promise<THREE.BufferGeometry | null>((resolve) => {
    let loader: GLTFLoader;
    try {
      loader = new GLTFLoader();
    } catch (e) {
      console.warn("[새지형] 로더를 못 만들었다:", e);
      resolve(null);
      return;
    }
    try {
      loader.load(
        TERRAIN_GLB_URL,
        (gltf) => {
          const geometry = findFirstMesh(gltf)?.geometry ?? null;
          // 검사 도구(tools/headlessPage · export-local-ids)가 「구운 땅이 올라왔나」를 이 표식으로 본다 — 면 수는 판마다 다르다
          if (geometry) geometry.userData.isBakedTerrain = true;
          resolve(geometry);
        },
        undefined,
        (e) => {
          console.warn("[새지형] GLB 를 못 읽었다 — 해석 지형으로 간다:", e);
          resolve(null);
        },
      );
    } catch (e) {
      console.warn("[새지형] GLB 읽기가 던졌다:", e);
      resolve(null);
    }
  });
}

// 결과(ready·failed)는 모듈에 두어 훅이 렌더 중에 동기로 꺼낸다.
let loading: Promise<BakedTerrain> | null = null;
let settled: BakedTerrain | null = null;

/** 한 번만 읽고 거절하지 않는다. */
function loadBakedTerrain(): Promise<BakedTerrain> {
  loading ??= (async () => {
    const startedAt = performance.now();
    // 서로 상관없는 두 파일이라 같이 받는다. 둘 다 실패해도 null 을 돌려줘 Promise.all 이 먼저 거절될 일이 없다.
    const [heightTable, geometry] = await Promise.all([loadHeightTable(), loadTerrainGeometry()]);
    if (!geometry || !heightTable) return FAILED;
    // 8.9 MB 라 느린 회선에서 조용히 해석식 지형으로 돌아가면 티가 안 나서 한 줄 남긴다.
    // 헤드리스(SwiftShader)에선 20 초가 넘게 걸린다 — 검사 스크립트가 이 줄을 기다린다.
    console.log(
      `[새지형] 준비됨 — ${heightTable.nx}×${heightTable.nz} 격자 · ` +
        `${(geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3} 삼각형 · ` +
        `${((performance.now() - startedAt) / 1000).toFixed(1)}초`,
    );
    // 법선은 다시 계산하지 않는다 — GLB 가 이미 싣고 왔고, 6.4 만 꼭짓점을 훑으면 전환할 때 한 박자 멈춘다.
    return { geometry, heightTable, status: "ready" } satisfies BakedTerrain;
  })()
    .catch(() => FAILED)
    .then((result) => (settled = result));
  return loading;
}

/** enabled 가 false 면 아무것도 안 읽는다(해석식 지형 그대로). 한 번 읽은 결과는 껐다 켜도 다시 쓴다. */
export function useBakedTerrain(enabled: boolean): BakedTerrain {
  // 결과는 모듈에 있고, 도착했을 때 다시 그리게만 한다. 같은 결과는 같은 객체라 씬의 memo 가 다시 돌지 않는다.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const result = settled;

  useEffect(() => {
    if (!enabled || result) return;
    let isAlive = true;
    loadBakedTerrain().then(() => {
      if (isAlive) rerender();
    });
    return () => {
      isAlive = false;
    };
  }, [enabled, result]);

  if (!enabled) return IDLE;
  return result ?? LOADING;
}
