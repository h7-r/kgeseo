import { useMemo } from "react";

import type { PresentedControls } from "../app/presentation";
import { useTexturedModels, type TexturedModel } from "../loaders/useTexturedModels";
import {
  bushModels,
  flowerModels,
  pebblePrototypes,
  rockModels,
  thatchedHouseModels,
  treeModels,
  weedModels,
} from "../models/nature";
import {
  DISTORTION_STAGE_IDS,
  DISTORTION_STAGES,
  type DistortionKind,
  type DistortionStageOption,
} from "../story/distortion";
import {
  bonfirePrototypes,
  cairnPrototypes,
  fishTrapPrototypes,
  netFramePrototypes,
  scene1Spots,
  serpentPrototypes,
  tentPrototypes,
} from "../story/scene1";
import {
  aFrameCarrierPrototypes,
  birdPolePrototypes,
  platformBedPrototypes,
  scene2Spots,
  stoolPrototypes,
  waterJarPrototypes,
} from "../story/scene2";
import {
  brokenBranchPrototypes,
  dirtClodPrototypes,
  hairRibbonPrototypes,
  scene3Spots,
  strawShoePrototypes,
} from "../story/scene3";
import { boatMarkPrototypes, footprintPrototypes, scene4Spots, stakePrototypes } from "../story/scene4";
import { scene5Spots, sacredRopePrototypes, smallTablePrototypes } from "../story/scene5";
import { rockPrototypes } from "../terrain/ground";
import { distantHousePrototypes, distantTreePrototypes } from "../world/distantLandscape";
import { landingPrototypes } from "../world/ferryLanding";
import { postPrototypes, railPrototypes } from "../world/fences";
import { steppingStonePrototypes, steppingStoneSpots } from "../world/steppingStones";
import { leafPilePrototypes, shrubPrototypes, treePrototypes } from "../world/vegetation";
import type { NajuPrototypes } from "./parts/buildInstanceGroups";
import type { GroundLayer } from "./useTerrainLayers";

type GroundHeight = (x: number, z: number) => number;

/** 텍스처째 받은 모형들 — 도착하기 전까지는 손으로 깎은 표본(또는 아무것도)으로 선다. */
export function useStoryModels() {
  const serpent = useTexturedModels("serpent");
  const abisa = useTexturedModels("abisa");
  const fisher = useTexturedModels("fisher");
  const fisher2 = useTexturedModels("fisher2");
  const fisher3 = useTexturedModels("fisher3");
  return { serpent, abisa, fisher, fisher2, fisher3 };
}

/** 무리마다 쓸 표본. 손으로 깎은 것 ↔ Meshy 모형은 성격이 달라 눈으로 보고 고른다(모형자연). */
export function usePrototypes(T: PresentedControls, bakedSerpent: TexturedModel) {
  return useMemo<NajuPrototypes>(
    () => ({
      trees: T.bakedNature ? treeModels() : treePrototypes(5, 9001),
      shrubs: T.bakedNature ? bushModels() : shrubPrototypes(5, 9003),
      // 손으로 깎은 잎더미는 모형자연을 껐을 때만 쓴다.
      leafPiles: T.bakedNature ? bushModels() : leafPilePrototypes(5, 9002),
      // 돌은 자갈 전용 — 1,699 개라 모형으로 바꾸면 열두 배가 된다.
      stones: rockPrototypes(6, 7301),
      rocks: T.bakedNature ? rockModels() : rockPrototypes(6, 7301),
      // 자갈 무리는 바위 7 + 자갈돌 7 을 한 묶음으로 받는다
      pebbles: T.bakedNature ? pebblePrototypes() : rockPrototypes(6, 7301),
      posts: postPrototypes(4, 3301),
      rails: railPrototypes(3, 5507),
      distantTrees: distantTreePrototypes(6, 4801),
      distantHouses: T.bakedNature ? thatchedHouseModels() : distantHousePrototypes(6203),
      weeds: weedModels(),
      flowers: flowerModels(),
      landings: landingPrototypes(3, 8801),
      steppingStones: steppingStonePrototypes(6, 6101),
      netFrames: netFramePrototypes(3, 1301),
      fishTraps: fishTrapPrototypes(),
      tents: tentPrototypes(),
      cairns: cairnPrototypes(3, 2203),
      bonfires: bonfirePrototypes(3, 3307),
      // 색까지 구워 온 모형이 있으면 그것을 쓴다(눈·혀를 기하로 추측해 칠한 표본보다 낫다).
      serpents: (T.bakedNature ? bakedSerpent.prototypes : null) ?? serpentPrototypes(),
      platformBeds: platformBedPrototypes(3, 5201),
      stools: stoolPrototypes(4, 5202),
      aFrameCarriers: aFrameCarrierPrototypes(3, 5203),
      waterJars: waterJarPrototypes(3, 5204),
      birdPoles: birdPolePrototypes(3, 5205),
      strawShoes: strawShoePrototypes(2, 6301),
      hairRibbons: hairRibbonPrototypes(3, 6302),
      dirtClods: dirtClodPrototypes(4, 6303),
      brokenBranches: brokenBranchPrototypes(3, 6304),
      boatMarks: boatMarkPrototypes(3, 7401),
      stakes: stakePrototypes(3, 7402),
      footprints: footprintPrototypes(3, 7403),
      sacredRopes: sacredRopePrototypes(2, 8501),
      smallTables: smallTablePrototypes(3, 8502),
      // 씬 5 돌무지는 씬 1 돌탑 표본 그대로 — 같은 손이 쌓은 것으로 보여야 한다.
      stonePiles: cairnPrototypes(3, 2203),
    }),
    // 구운 구렁이 표본이 여기 있어야 모형이 도착했을 때 표본이 바뀐다.
    [T.bakedNature, bakedSerpent.prototypes],
  );
}

/**
 * 땅 위에 자리를 깐다 — 돌다리·씬1~씬5 가 똑같은 몸통을 쓴다.
 * 부르는 횟수·순서가 렌더마다 같으므로 훅 규칙에 어긋나지 않는다.
 */
function useGroundSpots<T>(
  enabled: boolean,
  ground: GroundLayer | null,
  build: (options: { groundHeight: GroundHeight }) => T,
): T | null {
  return useMemo(() => {
    const surface = ground?.surface;
    if (!enabled || !surface) return null;
    return build({ groundHeight: (x, z) => surface.heightAt(x, z) });
  }, [enabled, ground, build]);
}

export type StoryProps = ReturnType<typeof useStoryProps>;

/** 돌다리·왜곡·씬1~씬5 요소 자리. 무리 id 가 전부 `씬N.` 으로 시작해 씬 상태 장치가 앞머리만 보고 켜고 끌 수 있다. */
export function useStoryProps(T: PresentedControls, ground: GroundLayer) {
  // 돌다리 — 자리는 강 굽이 함수에서 나온다. 걷는 판정은 없다.
  const steppingStones = useGroundSpots(T.steppingStones, ground, steppingStoneSpots);

  // 왜곡을 끄면 세기 0 — 「왜곡 없는 화면」과 대 봐야 무엇이 달라졌는지 판정이 된다.
  const distortion = useMemo(() => {
    const stage =
      DISTORTION_STAGES[DISTORTION_STAGE_IDS[T.distortionStage as DistortionStageOption]] ?? DISTORTION_STAGES.initial;
    if (!T.showDistortion) return { strength: 0, kind: "none" as DistortionKind, waterShift: 0, description: "꺼 둠" };
    const factor = T.distortionStrength ?? 1;
    return {
      ...stage,
      strength: Math.min(1, stage.strength * factor),
      waterShift: Math.min(1, stage.waterShift * factor),
    };
  }, [T.showDistortion, T.distortionStage, T.distortionStrength]);

  const scene1 = useGroundSpots(T.scene1Props, ground, scene1Spots);
  const scene2 = useGroundSpots(T.scene2Props, ground, scene2Spots);
  const scene3 = useGroundSpots(T.scene3Props, ground, scene3Spots);
  const scene4 = useGroundSpots(T.scene4Props, ground, scene4Spots);
  const scene5 = useGroundSpots(T.scene5Props, ground, scene5Spots);

  return { steppingStones, distortion, scene1, scene2, scene3, scene4, scene5 };
}
