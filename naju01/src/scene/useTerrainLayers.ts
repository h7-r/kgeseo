import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import type { PresentedControls } from "../app/presentation";
import { loadRock, ROCK_FILES } from "../loaders/rockAssets";
import type { Spot } from "../placement/instanceGroups";
import { CORE, RIVER, SHOULDER_DEFAULTS, VIEWPOINTS } from "../plan/sitePlan";
import { applyBakedTerrainTexture } from "../terrain/bakedTerrainTexture";
import { buildCliffFace, buildScree, computeBoulderSpots, computeCliffBushSpots } from "../terrain/cliff";
import { buildGround, computeContactShadows, computeGroundScatter, createNoise } from "../terrain/ground";
import { createGroundSurface } from "../terrain/groundSurface";
import { createTerrain } from "../terrain/terrain";
import { useBakedTerrain } from "../terrain/useBakedTerrain";

export type Terrain = ReturnType<typeof createTerrain>;
export type GroundShapes = ReturnType<typeof useGroundAndCliff>["ground"];
export type CliffShapes = ReturnType<typeof useGroundAndCliff>["cliffShapes"];

/** 도면에 늘 있는 구역(Z1~Z4) 하나. */
export function getZone(terrain: Terrain, code: string) {
  const zone = terrain.zones.find((z) => z.code === code);
  if (!zone) throw new Error(`구역 ${code} 이 없다`);
  return zone;
}

/** 지형 한 벌 + 블렌더가 구운 땅. 절벽 높이를 돌리면 Z3 고도 → T3·T4 경사 → 그 위 차단물까지 같이 다시 만들어진다. */
export function useTerrain(controls: PresentedControls) {
  const terrain = useMemo(
    () =>
      createTerrain({
        cliffHeight: controls.cliffHeight,
        blockerScale: controls.blockerHeight,
        // 갓길을 돌리면 판정도 같이 움직여야 보이는 길과 밟히는 길이 안 갈린다.
        shoulder: { width: controls.shoulderWidth, drop: controls.shoulderDrop, reach: SHOULDER_DEFAULTS.reach },
      }),
    [controls.cliffHeight, controls.blockerHeight, controls.shoulderWidth, controls.shoulderDrop],
  );

  // 판정은 높이표로 갈아끼운다 — y 만 바뀌고 구역·통로·물 깃발은 그대로다.
  const bakedTerrain = useBakedTerrain(controls.useBlenderTerrain);
  useEffect(() => {
    terrain.setHeightTable(controls.useBlenderTerrain ? bakedTerrain.heightTable : null);
  }, [terrain, controls.useBlenderTerrain, bakedTerrain.heightTable]);
  const isBakedTerrainOn = controls.useBlenderTerrain && bakedTerrain.status === "ready";

  return { terrain, bakedTerrain, isBakedTerrainOn };
}

/** 땅 표면·바닥 메시와 절벽면. 땅·길 비탈 발치·절벽 가장자리가 같은 surface 를 봐야 맞닿는 값이 같다. */
export function useGroundAndCliff(controls: PresentedControls, terrain: Terrain, isBakedTerrainOn: boolean) {
  const ground = useMemo(() => {
    // 새 땅은 미세결이 이미 메시에 구워져 있다. 요철을 또 얹으면 에셋이 최대 12 cm 뜨거나 잠긴다.
    const surface = createGroundSurface({ terrain, bumpScale: isBakedTerrainOn ? 0 : controls.groundBumpScale });
    if (!controls.groundDetail) return { surface, mesh: null, pebbleSpots: [], shadeAt: () => 0 };
    const clumpNoise = createNoise(310977);
    // 돌을 먼저 놓아야 땅이 그 발치를 어둡게 칠한다. 지오메트리는 안 쓰고 자리만 받아 인스턴스로 심는다.
    const { footprints, spots: pebbleSpots } = computeGroundScatter({
      surface,
      core: CORE,
      densityScale: controls.scatterDensity,
      seed: 4101,
      clumpNoise,
      // 길 위·차단물 속·강에는 안 뿌린다
      canPlace: (x, z) =>
        !terrain.groundAt(x, z).path && !terrain.blockedAt(x, z, terrain.groundAt(x, z).y, 0.4) && z < RIVER.zStart,
    });
    const shadeAt = computeContactShadows(footprints);
    return {
      surface,
      pebbleSpots,
      shadeAt,
      mesh: buildGround({
        surface,
        core: CORE,
        cliff: terrain.cliff,
        cellsPerMeter: controls.groundCellsPerMeter,
        normalExaggeration: controls.normalExaggeration,
        shade: shadeAt,
      }),
    };
  }, [
    terrain,
    controls.groundDetail,
    controls.groundBumpScale,
    controls.groundCellsPerMeter,
    controls.scatterDensity,
    controls.normalExaggeration,
    isBakedTerrainOn,
  ]);
  useEffect(() => () => ground.mesh?.dispose(), [ground]);

  // 땅이 기준면 아래로 파일 수 있는 깊이 — 밑받침을 이만큼 낮춰야 z-파이팅이 안 난다.
  const maxDip = controls.groundDetail ? ground.surface.maxBump + 0.02 : 0;

  // 절벽면 — 높이를 돌리면 지층 개수까지 통째로 다시 새겨진다.
  const cliffShapes = useMemo(() => {
    if (!controls.cliffDetail) return null;
    const grainNoise = createNoise(51733);
    const strataNoise = createNoise(902114);
    const stainNoise = createNoise(63301);
    return {
      face: buildCliffFace({
        cliff: terrain.cliff,
        cellsPerMeter: controls.cliffCellsPerMeter,
        carveDepth: controls.cliffCarveDepth,
        strataThickness: controls.strataThickness,
        angularity: controls.angularity,
        grainNoise,
        strataNoise,
        blotchNoise: stainNoise,
      }),
      scree: buildScree({
        cliff: terrain.cliff,
        count: controls.screeCount,
        seed: 771123,
        grainNoise,
        // 발치 돌은 이상적인 빗면이 아니라 진짜 땅에 박혀야 한다
        heightAt: (x, z) => ground.surface.heightAt(x, z),
      }),
      // 바위 덩어리는 도면의 4 m 띠 밖에 붙인다 — 띠 안에서는 아무리 흔들어도 벽이 된다.
      boulderSpots: controls.boulders
        ? computeBoulderSpots({ cliff: terrain.cliff, heightAt: (x, z) => ground.surface.heightAt(x, z) })
        : [],
      // 맨 암벽은 모형으로 보인다 — 틈마다 덤불을 박는다(자리만 내고 인스턴스로 심는다).
      crevasseShrubSpots: controls.cliffVegetation
        ? computeCliffBushSpots({
            cliff: terrain.cliff,
            count: controls.cliffShrubCount,
            seed: 330817,
            grainNoise,
            strataNoise,
            carveDepth: controls.cliffCarveDepth,
            strataThickness: controls.strataThickness,
            angularity: controls.angularity,
          })
        : [],
      topTreeSpots: controls.cliffVegetation
        ? computeCliffTopTreeSpots(terrain.cliff, controls.cliffTreeCount, ground.surface.heightAt)
        : [],
    };
  }, [
    ground,
    terrain,
    controls.cliffDetail,
    controls.cliffCellsPerMeter,
    controls.cliffCarveDepth,
    controls.strataThickness,
    controls.angularity,
    controls.screeCount,
    controls.cliffVegetation,
    controls.cliffShrubCount,
    controls.cliffTreeCount,
    controls.boulders,
  ]);
  useEffect(
    () => () => {
      cliffShapes?.face?.dispose();
      cliffShapes?.scree?.dispose();
    },
    [cliffShapes],
  );

  return { ground, maxDip, cliffShapes };
}

/** 밖에서 만들어 온 바위(assets/rocks/*.glb) */
export function useRockAsset(controls: PresentedControls) {
  const [rockAsset, setRockAsset] = useState<Awaited<ReturnType<typeof loadRock>>>(null);
  useEffect(() => {
    let isAlive = true;
    if (!controls.rockAsset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 끄면 읽어 둔 바위를 버려야 다시 켤 때 새로 읽는다
      setRockAsset(null);
      return;
    }
    loadRock({ widthMeters: controls.rockAssetWidth })
      .then((rock) => {
        if (!isAlive) return;
        setRockAsset(rock);
        if (!rock && ROCK_FILES.length === 0) console.info("assets/rocks/ 에 .glb 가 없다 — 넣으면 자동으로 잡힌다");
      })
      .catch((e: unknown) => console.warn("바위 에셋을 못 읽었다:", e));
    return () => {
      isAlive = false;
    };
  }, [controls.rockAsset, controls.rockAssetWidth]);
  return rockAsset;
}

/** 구운 지형 텍스처 — 재질만 바꾸므로 판정 숫자는 안 변한다. */
export function useBakedTerrainTexture(scene: THREE.Scene, enabled: boolean) {
  useEffect(() => {
    applyBakedTerrainTexture(scene, enabled).catch((e: unknown) => console.warn("구운 지형 텍스처를 못 입혔다:", e));
  }, [scene, enabled]);
}

// V2 앞의 창 — §4 가 「사건 이해를 위해 의도적으로 열어 둔 유일한 시선」이라 못박았는데 절벽 머리 덤불이
// V2 에서 Z2 를 0 % 로 막았다. 네모로 도려내면 실루엣에 자로 그은 홈이 생기므로 한복판은 비우고 가장자리는 키를 서서히 되돌린다.
const WINDOW_HALF_WIDTH = 3.5; // m — V2 에서 Z2 로 가는 광선다발이 마루를 넘는 폭
const WINDOW_FADE = 3.0; // m — 키가 0 에서 제 키로 돌아오는 구간

function computeCliffTopTreeSpots(
  cliff: { x: [number, number]; zTop: number },
  count: number,
  heightAt: (x: number, z: number) => number,
): Spot[] {
  const noise = createNoise(551903);
  const spots: Spot[] = [];
  const V2 = VIEWPOINTS.find((v) => v.code === "V2");
  const windowCenter = V2?.x ?? 45;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = cliff.x[0] + (cliff.x[1] - cliff.x[0]) * t;
    const z = cliff.zTop + 0.3 + (noise(x * 0.7, 3.1) * 0.5 + 0.5) * 2.7;
    const offset = Math.abs(x - windowCenter);
    if (offset < WINDOW_HALF_WIDTH) continue;
    const share = THREE.MathUtils.smoothstep(offset, WINDOW_HALF_WIDTH, WINDOW_HALF_WIDTH + WINDOW_FADE);
    const size = (2.6 + (noise(x * 1.3 + 11, 7.7) * 0.5 + 0.5) * 2.6) * share;
    if (size < 0.4) continue; // 너무 낮으면 덤불이 아니라 얼룩이다
    spots.push({ x, z, y: heightAt(x, z), size });
  }
  return spots;
}
