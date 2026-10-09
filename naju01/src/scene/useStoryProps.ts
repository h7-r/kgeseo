import { useMemo } from "react";

import type { PresentedControls } from "../app/presentation";
import { useTexturedModel, type TexturedModel } from "../loaders/useTexturedModel";
import {
  buildBakedBushPrototypes,
  buildBakedFlowerPrototypes,
  buildBakedRockPrototypes,
  buildBakedThatchedHousePrototypes,
  buildBakedTreePrototypes,
  buildBakedWeedPrototypes,
  buildPebblePrototypes,
} from "../models/nature";
import {
  DISTORTION_STAGE_IDS,
  DISTORTION_STAGES,
  type DistortionKind,
  type DistortionStageOption,
} from "../story/distortion";
import {
  buildBonfirePrototypes,
  buildCairnPrototypes,
  buildFishTrapPrototypes,
  buildNetFramePrototypes,
  buildSerpentPrototypes,
  buildTentPrototypes,
  computeScene1Spots,
} from "../story/scene1";
import {
  buildAFrameCarrierPrototypes,
  buildBirdPolePrototypes,
  buildPlatformBedPrototypes,
  buildStoolPrototypes,
  buildWaterJarPrototypes,
  computeScene2Spots,
} from "../story/scene2";
import {
  buildBrokenBranchPrototypes,
  buildDirtClodPrototypes,
  buildHairRibbonPrototypes,
  buildStrawShoePrototypes,
  computeScene3Spots,
} from "../story/scene3";
import {
  buildBoatMarkPrototypes,
  buildFootprintPrototypes,
  buildStakePrototypes,
  computeScene4Spots,
} from "../story/scene4";
import { buildSacredRopePrototypes, buildSmallTablePrototypes, computeScene5Spots } from "../story/scene5";
import { buildRockPrototypes, type HeightAt } from "../terrain/ground";
import { buildDistantHousePrototypes, buildDistantTreePrototypes } from "../world/distantLandscape";
import { buildLandingPrototypes } from "../world/ferryLanding";
import { buildPostPrototypes, buildRailPrototypes } from "../world/fences";
import { buildSteppingStonePrototypes, computeSteppingStoneSpots } from "../world/steppingStones";
import { buildLeafPilePrototypes, buildShrubPrototypes, buildTreePrototypes } from "../world/vegetation";
import type { NajuPrototypes } from "./buildInstanceGroups";
import type { GroundShapes } from "./useTerrainLayers";

/** 텍스처째 받은 모형들 — 도착하기 전까지는 손으로 깎은 표본(또는 아무것도)으로 선다. */
export function useStoryModels() {
  const serpent = useTexturedModel("serpent");
  const abisa = useTexturedModel("abisa");
  const fisher = useTexturedModel("fisher");
  const fisher2 = useTexturedModel("fisher2");
  const fisher3 = useTexturedModel("fisher3");
  return { serpent, abisa, fisher, fisher2, fisher3 };
}

/** 무리마다 쓸 표본. 손으로 깎은 것 ↔ Meshy 모형은 성격이 달라 눈으로 보고 고른다(모형자연). */
export function usePrototypes(controls: PresentedControls, bakedSerpent: TexturedModel) {
  return useMemo<NajuPrototypes>(
    () => ({
      trees: controls.bakedNature ? buildBakedTreePrototypes() : buildTreePrototypes(5, 9001),
      shrubs: controls.bakedNature ? buildBakedBushPrototypes() : buildShrubPrototypes(5, 9003),
      // 손으로 깎은 잎더미는 모형자연을 껐을 때만 쓴다.
      leafPiles: controls.bakedNature ? buildBakedBushPrototypes() : buildLeafPilePrototypes(5, 9002),
      // 돌은 자갈 전용 — 1,699 개라 모형으로 바꾸면 열두 배가 된다.
      stones: buildRockPrototypes(6, 7301),
      rocks: controls.bakedNature ? buildBakedRockPrototypes() : buildRockPrototypes(6, 7301),
      // 자갈 무리는 바위 7 + 자갈돌 7 을 한 묶음으로 받는다
      pebbles: controls.bakedNature ? buildPebblePrototypes() : buildRockPrototypes(6, 7301),
      posts: buildPostPrototypes(4, 3301),
      rails: buildRailPrototypes(3, 5507),
      distantTrees: buildDistantTreePrototypes(6, 4801),
      distantHouses: controls.bakedNature ? buildBakedThatchedHousePrototypes() : buildDistantHousePrototypes(6203),
      weeds: buildBakedWeedPrototypes(),
      flowers: buildBakedFlowerPrototypes(),
      landings: buildLandingPrototypes(3, 8801),
      steppingStones: buildSteppingStonePrototypes(6, 6101),
      netFrames: buildNetFramePrototypes(3, 1301),
      fishTraps: buildFishTrapPrototypes(),
      tents: buildTentPrototypes(),
      cairns: buildCairnPrototypes(3, 2203),
      bonfires: buildBonfirePrototypes(3, 3307),
      // 색까지 구워 온 모형이 있으면 그것을 쓴다(눈·혀를 기하로 추측해 칠한 표본보다 낫다).
      serpents: (controls.bakedNature ? bakedSerpent.prototypes : null) ?? buildSerpentPrototypes(),
      platformBeds: buildPlatformBedPrototypes(3, 5201),
      stools: buildStoolPrototypes(4, 5202),
      aFrameCarriers: buildAFrameCarrierPrototypes(3, 5203),
      waterJars: buildWaterJarPrototypes(3, 5204),
      birdPoles: buildBirdPolePrototypes(3, 5205),
      strawShoes: buildStrawShoePrototypes(2, 6301),
      hairRibbons: buildHairRibbonPrototypes(3, 6302),
      dirtClods: buildDirtClodPrototypes(4, 6303),
      brokenBranches: buildBrokenBranchPrototypes(3, 6304),
      boatMarks: buildBoatMarkPrototypes(3, 7401),
      stakes: buildStakePrototypes(3, 7402),
      footprints: buildFootprintPrototypes(3, 7403),
      sacredRopes: buildSacredRopePrototypes(2, 8501),
      smallTables: buildSmallTablePrototypes(3, 8502),
      // 씬 5 돌무지는 씬 1 돌탑 표본 그대로 — 같은 손이 쌓은 것으로 보여야 한다.
      stonePiles: buildCairnPrototypes(3, 2203),
    }),
    // 구운 구렁이 표본이 여기 있어야 모형이 도착했을 때 표본이 바뀐다.
    [controls.bakedNature, bakedSerpent.prototypes],
  );
}

/**
 * 땅 위에 자리를 깐다 — 돌다리·씬1~씬5 가 똑같은 몸통을 쓴다.
 * 부르는 횟수·순서가 렌더마다 같으므로 훅 규칙에 어긋나지 않는다.
 */
function useGroundSpots<Spots>(
  enabled: boolean,
  ground: GroundShapes | null,
  build: (options: { heightAt: HeightAt }) => Spots,
): Spots | null {
  return useMemo(() => {
    const surface = ground?.surface;
    if (!enabled || !surface) return null;
    return build({ heightAt: (x, z) => surface.heightAt(x, z) });
  }, [enabled, ground, build]);
}

export type StoryProps = ReturnType<typeof useStoryProps>;

/** 돌다리·왜곡·씬1~씬5 요소 자리. 무리 id 가 전부 `씬N.` 으로 시작해 씬 상태 장치가 앞머리만 보고 켜고 끌 수 있다. */
export function useStoryProps(controls: PresentedControls, ground: GroundShapes) {
  // 돌다리 — 자리는 강 굽이 함수에서 나온다. 걷는 판정은 없다.
  const steppingStones = useGroundSpots(controls.steppingStones, ground, computeSteppingStoneSpots);

  // 왜곡을 끄면 세기 0 — 「왜곡 없는 화면」과 대 봐야 무엇이 달라졌는지 판정이 된다.
  const distortion = useMemo(() => {
    const stage =
      DISTORTION_STAGES[DISTORTION_STAGE_IDS[controls.distortionStage as DistortionStageOption]] ??
      DISTORTION_STAGES.initial;
    if (!controls.showDistortion)
      return { strength: 0, kind: "none" as DistortionKind, waterShift: 0, description: "꺼 둠" };
    const factor = controls.distortionStrength ?? 1;
    return {
      ...stage,
      strength: Math.min(1, stage.strength * factor),
      waterShift: Math.min(1, stage.waterShift * factor),
    };
  }, [controls.showDistortion, controls.distortionStage, controls.distortionStrength]);

  const scene1 = useGroundSpots(controls.scene1Props, ground, computeScene1Spots);
  const scene2 = useGroundSpots(controls.scene2Props, ground, computeScene2Spots);
  const scene3 = useGroundSpots(controls.scene3Props, ground, computeScene3Spots);
  const scene4 = useGroundSpots(controls.scene4Props, ground, computeScene4Spots);
  const scene5 = useGroundSpots(controls.scene5Props, ground, computeScene5Spots);

  return { steppingStones, distortion, scene1, scene2, scene3, scene4, scene5 };
}
