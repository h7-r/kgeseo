// NAJU-01 A-01 도면을 그대로 세운 그레이박스. 상자와 치수로 공간을 세우고 1인칭으로 걸어 보며
// 넓이·높이·경사·동선·시야(V1~V3)가 도면과 맞는지 먼저 확인한다 — 꾸미기는 그 뒤다.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Outlines, PointerLockControls } from "@react-three/drei";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import { exposeDevHook } from "@/debug/devHooks";
import type { AvatarLink } from "@/engine/avatarLink";
import { scaleColor } from "@/engine/color";
import { mergeBoxes, type MergeBox } from "@/engine/geometry";
import { pickOutline } from "@/engine/leva/savedControls";
import { makeRandom } from "@/engine/random";
import { requestShadowUpdates, ShaderWarmup, ShadowManager } from "@/engine/rendering";
import { TOON_GRADIENT } from "@/engine/toon";

import { SHOW_DEV_TOOLS } from "../app/runtimeFlags";
import type { ToonConfig } from "../avatar/toonMaterial";
import type { OutlineConfig } from "../avatar/toonOutline";
import type { MeshAppearanceConfig } from "../avatar/meshAppearance";
import type { SidekickConfig } from "../avatar/sidekickOptions";
import { parseGlb, firstMesh, fitRealSize } from "../loaders/glbImport";
import { loadRock, ROCK_FILES } from "../loaders/rockAssets";
import { useTexturedModels } from "../loaders/useTexturedModels";
import {
  bushModels,
  flowerModels,
  pebblePrototypes,
  rockModels,
  thatchedHouseModels,
  treeModels,
  weedModels,
} from "../models/nature";
import { buildCameraOccluders, buildPropColliders } from "../movement/propColliders";
import { useTerrainMovement, type MovementReport } from "../movement/useTerrainMovement";
import Editor from "../placement/Editor";
import { emptyEdits, GROUP_IDS, loadEdits } from "../placement/editFile";
import type { Spot } from "../placement/instanceGroups";
import { MESH_NAMES } from "../plan/meshNames";
import {
  CORE,
  INVESTIGATION_POINTS,
  NPC,
  RIVER,
  SCENE_TITLES,
  SECTIONS,
  SHOULDER_DEFAULTS,
  UNITS_PER_METER,
  VIEWPOINTS,
} from "../plan/sitePlan";
import { createCollapseSequence, collapseTransform, type CollapseSequence } from "../story/blockerCollapse";
import {
  DISTORTION_STAGE_IDS,
  DISTORTION_STAGES,
  waterDistortion,
  type DistortionKind,
  type DistortionStageOption,
} from "../story/distortion";
import {
  bonfirePrototypes,
  cairnPrototypes,
  fishTrapPrototypes,
  netFramePrototypes,
  SCENE1_NOTES,
  scene1Spots,
  serpentPrototypes,
  tentPrototypes,
} from "../story/scene1";
import {
  aFrameCarrierPrototypes,
  birdPolePrototypes,
  platformBedPrototypes,
  SCENE2_NOTES,
  scene2Spots,
  stoolPrototypes,
  waterJarPrototypes,
} from "../story/scene2";
import {
  brokenBranchPrototypes,
  dirtClodPrototypes,
  hairRibbonPrototypes,
  SCENE3_NOTES,
  scene3Spots,
  strawShoePrototypes,
} from "../story/scene3";
import { boatMarkPrototypes, footprintPrototypes, SCENE4_NOTES, scene4Spots, stakePrototypes } from "../story/scene4";
import { SCENE5_NOTES, scene5Spots, sacredRopePrototypes, smallTablePrototypes } from "../story/scene5";
import { applyBakedTerrainTexture } from "../terrain/bakedTerrainTexture";
import { boulderSpots, buildBoulders, buildCliffFace, buildScree, cliffBushSpots } from "../terrain/cliff";
import { buildConnectorRamp } from "../terrain/connectorRamp";
import { buildContactShadows, buildGround, buildGroundScatter, createNoise, rockPrototypes } from "../terrain/ground";
import { setGrainStrength } from "../terrain/groundGrain";
import { createGroundSurface } from "../terrain/groundSurface";
import { buildPaths, roadsideStoneSpots } from "../terrain/slopePaths";
import { createTerrain } from "../terrain/terrain";
import { bakeUnderpaint, collectTerrain, exportTerrainGlb, groundCellRect } from "../terrain/terrainAtlas";
import { useBakedTerrain } from "../terrain/useBakedTerrain";
import {
  buildFields,
  buildForestVillages,
  buildMountainRidges,
  distantHousePrototypes,
  distantTreePrototypes,
} from "../world/distantLandscape";
import { ferryBoatPrototype, landingPrototypes } from "../world/ferryLanding";
import { fenceSpots, postPrototypes, railPrototypes } from "../world/fences";
import { buildPeople } from "../world/people";
import { buildFarBank, buildRiverbank, buildRiverSurface, farBankBendAt } from "../world/river";
import { buildClouds, buildSkyDome, SKY_STYLE } from "../world/sky";
import { steppingStonePrototypes, steppingStoneSpots } from "../world/steppingStones";
import {
  buildGrass,
  leafPilePrototypes,
  roadsideBushSpots,
  scatterBushes,
  shrubPrototypes,
  treeBeltSpots,
  treePrototypes,
} from "../world/vegetation";
import { waterRippleRef, type RippleHandle } from "../world/waterRipples";
import WorldToon from "../world/WorldToon";
import AfterimageGroup from "./parts/AfterimageGroup";
import { buildInstanceGroups, type NajuPrototypes } from "./parts/buildInstanceGroups";
import GroundMaterial from "./parts/GroundMaterial";
import InstanceGroupMesh from "./parts/InstanceGroupMesh";
import Label from "./parts/Label";
import { planPoint } from "./parts/planPoint";
import SceneNoteLabel from "./parts/SceneNoteLabel";
import SlopeSegment, { type PlanPoint } from "./parts/SlopeSegment";
import { useGroundSpots } from "./parts/useGroundSpots";
import { toGroundShading, useNajuControls } from "./useNajuControls";

// 3인칭 캐릭터는 늦게 들여온다. 두 모듈은 실릴 때 useGLTF.preload 로 37 MB 를 받으므로
// 1인칭으로만 걸으면 통째로 버려진다 — V 를 처음 누를 때 그 갈래 하나만 싣는다.
// 아래 JSX 는 반드시 <Suspense> 안에 있어야 한다.
const SidekickGameAvatar = lazy(() => import("../avatar/SidekickGameAvatar"));
const ChibiGameAvatar = lazy(() => import("../avatar/ChibiGameAvatar"));

const U = UNITS_PER_METER;

export interface NajuSceneProps {
  active: boolean;
  controlsRef: RefObject<PointerLockControlsImpl | null>;
  onLockChange: (locked: boolean) => void;
  reportRef: RefObject<NajuSceneReport | null>;
  isThirdPerson?: boolean;
  sidekickConfig?: SidekickConfig;
  meshConfig?: MeshAppearanceConfig | null;
  /** world = 게임 공간 전체에도 cel 질감을 입힐지(?worldtoon=off 비교용) */
  toonConfig?: (ToonConfig & { world?: boolean }) | null;
  outlineConfig?: OutlineConfig | null;
}

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

interface CollapseState {
  code: string;
  progress: number;
}

const DIGIT_INDEX: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 };

export default function NajuScene({
  active,
  controlsRef,
  onLockChange,
  reportRef,
  isThirdPerson = false,
  sidekickConfig,
  meshConfig,
  toonConfig,
  outlineConfig,
}: NajuSceneProps) {
  // 카메라와 따로 둔 실제 플레이어 좌표. 아바타·지형 판정·카메라가 이 한 값을 봐야 경사에서 몸이 묻거나 뜨지 않는다.
  const playerState = useRef<AvatarLink>({
    position: new THREE.Vector3(),
    groundY: 0,
    footY: 0,
    facing: Math.PI,
    moving: false,
    running: false,
    crouching: false,
    grounded: true,
    jumping: false,
    speed: 0,
    verticalVelocity: 0,
    attackSerial: 0,
  });
  const T = useNajuControls();
  const shading = toGroundShading(T.groundShading);
  const outlineValues = pickOutline(T);
  // screenspace 를 켜야 thickness 가 월드 단위가 된다.
  const outline = outlineValues.outline ? (
    <Outlines thickness={T.outlineWorldWidth} color={outlineValues.outlineColor} screenspace />
  ) : null;
  const shade = (color: string) => scaleColor(color, T.brightness);
  const shadowBias = { "shadow-bias": -0.0005, "shadow-normalBias": T.shadowNormalBias };

  // 수면 잔결 — 재질이 생길 때 걸리고, 매 프레임 여기로 시각을 넣는다.
  const rippleHandle = useRef<RippleHandle | null>(null);
  const rippleMaterialRef = useCallback(
    (material: THREE.Material | null) => waterRippleRef(rippleHandle)(material),
    [],
  );

  // 지형 한 벌. 절벽 높이를 돌리면 Z3 고도 → T3·T4 경사 → 그 위 차단물까지 같이 다시 만들어진다.
  const terrain = useMemo(
    () =>
      createTerrain({
        cliffHeight: T.cliffHeight,
        blockerScale: T.blockerHeight,
        // 갓길을 돌리면 판정도 같이 움직여야 보이는 길과 밟히는 길이 안 갈린다.
        shoulder: { width: T.shoulderWidth, drop: T.shoulderDrop, reach: SHOULDER_DEFAULTS.reach },
      }),
    [T.cliffHeight, T.blockerHeight, T.shoulderWidth, T.shoulderDrop],
  );
  const { zones, measuredPaths, blockers, cliff } = terrain;

  // 블렌더가 구운 땅. 판정은 높이표로 갈아끼운다 — y 만 바뀌고 구역·통로·물 깃발은 그대로다.
  const bakedTerrain = useBakedTerrain(T.useBlenderTerrain);
  useEffect(() => {
    terrain.setHeightTable(T.useBlenderTerrain ? bakedTerrain.heightTable : null);
  }, [terrain, T.useBlenderTerrain, bakedTerrain.heightTable]);
  const isBakedTerrainOn = T.useBlenderTerrain && bakedTerrain.status === "ready";

  // 텍스처째 받은 모형들 — 도착하기 전까지는 옛 표본(또는 아무것도)으로 선다.
  const bakedSerpent = useTexturedModels("serpent");
  const bakedAbisa = useTexturedModels("abisa");
  const bakedFisher = useTexturedModels("fisher");
  const bakedFisher2 = useTexturedModels("fisher2");
  const bakedFisher3 = useTexturedModels("fisher3");

  // 땅 표면은 surface 하나가 정한다 — 땅·길 비탈 발치·절벽 가장자리가 같은 함수를 봐야 맞닿는 값이 같다.
  const ground = useMemo(() => {
    // 새 땅은 미세결이 이미 메시에 구워져 있다. 요철을 또 얹으면 에셋이 최대 12 cm 뜨거나 잠긴다.
    const surface = createGroundSurface({ terrain, bumpScale: isBakedTerrainOn ? 0 : T.groundBumpScale });
    if (!T.groundDetail) return { surface, mesh: null, pebbleSpots: [], shadeAt: () => 0 };
    const clumpNoise = createNoise(310977);
    // 돌을 먼저 놓아야 땅이 그 발치를 어둡게 칠한다. 지오메트리는 안 쓰고 자리만 받아 인스턴스로 심는다.
    const { footprints, spots: pebbleSpots } = buildGroundScatter({
      surface,
      core: CORE,
      densityScale: T.scatterDensity,
      seed: 4101,
      clumpNoise,
      // 길 위·차단물 속·강에는 안 뿌린다
      canPlace: (x, z) =>
        !terrain.groundAt(x, z).path && !terrain.blockedAt(x, z, terrain.groundAt(x, z).y, 0.4) && z < RIVER.zStart,
    });
    const shadeAt = buildContactShadows(footprints);
    return {
      surface,
      pebbleSpots,
      shadeAt,
      mesh: buildGround({
        surface,
        core: CORE,
        cliff: terrain.cliff,
        cellsPerMeter: T.groundCellsPerMeter,
        normalExaggeration: T.normalExaggeration,
        shade: shadeAt,
      }),
    };
  }, [
    terrain,
    T.groundDetail,
    T.groundBumpScale,
    T.groundCellsPerMeter,
    T.scatterDensity,
    T.normalExaggeration,
    isBakedTerrainOn,
  ]);
  useEffect(() => () => ground.mesh?.dispose(), [ground]);

  // 땅이 기준면 아래로 파일 수 있는 깊이 — 밑받침을 이만큼 낮춰야 z-파이팅이 안 난다.
  const maxDip = T.groundDetail ? ground.surface.maxBump + 0.02 : 0;

  // 절벽면 — 높이를 돌리면 지층 개수까지 통째로 다시 새겨진다.
  const cliffPieces = useMemo(() => {
    if (!T.cliffDetail) return null;
    const grainNoise = createNoise(51733);
    const strataNoise = createNoise(902114);
    const stainNoise = createNoise(63301);
    return {
      face: buildCliffFace({
        cliff: terrain.cliff,
        cellsPerMeter: T.cliffCellsPerMeter,
        carveDepth: T.cliffCarveDepth,
        strataThickness: T.strataThickness,
        angularity: T.angularity,
        grainNoise,
        strataNoise,
        blotchNoise: stainNoise,
      }),
      scree: buildScree({
        cliff: terrain.cliff,
        count: T.screeCount,
        seed: 771123,
        grainNoise,
        // 발치 돌은 이상적인 빗면이 아니라 진짜 땅에 박혀야 한다
        groundHeight: (x, z) => ground.surface.heightAt(x, z),
      }),
      // 바위 덩어리는 도면의 4 m 띠 밖에 붙인다 — 띠 안에서는 아무리 흔들어도 벽이 된다.
      boulderSpots: T.boulders
        ? boulderSpots({ cliff: terrain.cliff, groundHeight: (x, z) => ground.surface.heightAt(x, z) })
        : [],
      // 맨 암벽은 모형으로 보인다 — 틈마다 덤불을 박는다(자리만 내고 인스턴스로 심는다).
      crevasseShrubSpots: T.cliffVegetation
        ? cliffBushSpots({
            cliff: terrain.cliff,
            count: T.cliffShrubCount,
            seed: 330817,
            grainNoise,
            strataNoise,
            carveDepth: T.cliffCarveDepth,
            strataThickness: T.strataThickness,
            angularity: T.angularity,
          })
        : [],
      topTreeSpots: T.cliffVegetation
        ? cliffTopTreeSpots(terrain.cliff, T.cliffTreeCount, ground.surface.heightAt)
        : [],
    };
  }, [
    ground,
    terrain,
    T.cliffDetail,
    T.cliffCellsPerMeter,
    T.cliffCarveDepth,
    T.strataThickness,
    T.angularity,
    T.screeCount,
    T.cliffVegetation,
    T.cliffShrubCount,
    T.cliffTreeCount,
    T.boulders,
  ]);
  useEffect(
    () => () => {
      cliffPieces?.face?.dispose();
      cliffPieces?.scree?.dispose();
    },
    [cliffPieces],
  );

  // 차단물 조형 — 막는 부피는 그대로 두고 겉모습만 바꾼다. 바위는 안쪽으로만 파야 보이는 것과 막히는 것이 안 어긋난다.
  const blockerShapes = useMemo(() => {
    if (!T.blockerDetail) return null;
    const grainNoise = createNoise(884412);
    const strataNoise = createNoise(220719);
    const rock = (
      x: [number, number],
      z: [number, number],
      foot: number,
      top: number | ((x: number, z: number) => number),
    ) =>
      buildBoulders({
        x,
        z,
        foot,
        top,
        cellsPerMeter: T.rockCellsPerMeter,
        carveDepth: T.rockCarveDepth,
        angularity: T.angularity,
        strataThickness: T.strataThickness * 0.5, // 작은 덩어리라 지층도 촘촘해야 어울린다
        grainNoise,
        strataNoise,
        patternScale: T.rockPatternScale,
      });
    // Z3(+14)와 Z4(+8) 사이 골은 비스듬한 능선으로 본다(도면에 고도가 없어 내린 해석 — 팀 확인 필요).
    // 평평한 +14 벽이면 V3 의 주 차단 장치인 수목대가 눈높이 위로 올라가 구실을 못 한다.
    const z3Elevation = terrain.zones.find((z) => z.code === "Z3")!.elevation;
    const z4Elevation = terrain.zones.find((z) => z.code === "Z4")!.elevation;
    const ridgeTop = (x: number) =>
      THREE.MathUtils.lerp(z3Elevation, z4Elevation, THREE.MathUtils.clamp((x - 58) / 4, 0, 1));

    const pieces = terrain.blockers.map((b, i) => {
      const foot = b.foot ?? 0;
      const isInHollow = !!b.floorZone; // 빈 골에 선 것(B2 · 수목대)
      const isTreeBelt = b.code === "수목대";
      const top = isInHollow ? (x: number) => ridgeTop(x) + (isTreeBelt ? 0 : b.height) : b.floor + b.height;
      const topY = isInHollow ? ridgeTop((b.x[0] + b.x[1]) / 2) + b.height : (top as number);
      return {
        code: b.code,
        name: b.name,
        role: b.role,
        clearing: b.clearing ?? null,
        top: topY,
        // 무너뜨릴 때 내려야 하는 실제 키. 골에 선 것은 발이 0 인데 머리가 18 m 라 height 로는 14 m 가 남는다.
        actualHeight: topY - foot,
        center: [(b.x[0] + b.x[1]) / 2, (b.z[0] + b.z[1]) / 2] as [number, number],
        // 수목대는 '능선 바위 + 그 위의 나무', 나머지는 통짜 바위 덩이
        rock: rock(b.x, b.z, foot, top),
        // 나무는 자리만 낸다 — 심는 것은 인스턴스 무리다(편집기가 고를 수 있다).
        treeSpots: isTreeBelt
          ? treeBeltSpots({ x: b.x, z: b.z, ground: ridgeTop, height: b.height, count: T.treeCount, seed: 5511 + i })
          : null,
      };
    });

    // 높이 있는 구역(Z3·Z4)의 옆구리도 같은 바위로 세운다. 윗면은 땅 표면 그대로 조회하되,
    // 걷는 길 위에서는 노면 아래로 누른다 — 지표가 지면보다 높은 자리에서 바위가 노면 위로 솟았다.
    const zoneRocks = terrain.zones
      .filter((z) => z.elevation > 0)
      .map((z) => ({
        code: z.code,
        geometry: rock(z.x, z.z, -0.5, (x, zz) => {
          const surfaceY = ground.surface.heightAt(x, zz) - 0.02;
          const sample = terrain.groundAt(x, zz);
          return sample?.path && !sample.isShoulder ? Math.min(surfaceY, sample.y - 0.75) : surfaceY;
        }),
      }));

    // 발치 너덜 — 덩어리와 바닥이 만나는 선이 곧으면 얹어 놓은 것으로 보인다. 떨어져 나온 돌이 쌓여야 땅에서 솟은 것이 된다.
    const footScreeSpots: { x: number; z: number; y: number; size: number }[] = [];
    const scatterAround = (X: [number, number], Z: [number, number], floor: number, count: number, seed: number) => {
      const random = makeRandom(seed >>> 0);
      const w = X[1] - X[0];
      const d = Z[1] - Z[0];
      const perimeter = 2 * (w + d);
      for (let i = 0; i < count; i++) {
        let p = random() * perimeter;
        let x: number;
        let z: number;
        if (p < w) {
          x = X[0] + p;
          z = Z[0];
        } else if ((p -= w) < d) {
          x = X[1];
          z = Z[0] + p;
        } else if ((p -= d) < w) {
          x = X[1] - p;
          z = Z[1];
        } else {
          x = X[0];
          z = Z[1] - (p - w);
        }
        const out = 0.15 + random() * 1.1;
        const angle = random() * Math.PI * 2;
        // 대부분 잔돌, 가끔 큰 바위 — 크기가 중간에 몰리면 복사해 둔 돌로 보인다.
        const isBig = random() < 0.08;
        footScreeSpots.push({
          x: x + Math.cos(angle) * out,
          z: z + Math.sin(angle) * out,
          y: floor,
          size: isBig ? 1.4 + random() * 2.1 : 0.15 + Math.pow(random(), 2.6) * 1.0,
        });
      }
    };
    for (const b of terrain.blockers) scatterAround(b.x, b.z, b.foot ?? 0, 26, 4001 + b.code.length * 37);
    for (const z of terrain.zones) if (z.elevation > 0) scatterAround(z.x, z.z, 0, 90, 9001 + z.elevation * 13);

    return { pieces, zoneRocks, footScreeSpots };
  }, [
    terrain,
    T.blockerDetail,
    T.rockCellsPerMeter,
    T.rockCarveDepth,
    T.rockPatternScale,
    ground.surface,
    T.angularity,
    T.strataThickness,
    T.treeCount,
  ]);
  useEffect(
    () => () => {
      blockerShapes?.pieces.forEach((b) => b.rock?.dispose());
      blockerShapes?.zoneRocks.forEach((z) => z.geometry?.dispose());
    },
    [blockerShapes],
  );

  // 원경 — 코어 바깥 풍경. 갈 수 없는 곳이라 판정이 없다. 대지는 가까운 띠만 촘촘한 두 겹이다.
  const distant = useMemo(() => {
    if (!T.distantLandscape) return null;
    const noise = createNoise(515151);
    const nearFields = buildFields({
      core: CORE,
      river: RIVER,
      noise,
      inner: 0,
      outer: 265,
      cell: 7,
      horizonColor: SKY_STYLE.horizon,
    });
    const farFields = buildFields({
      core: CORE,
      river: RIVER,
      noise,
      inner: 250,
      outer: 1050,
      cell: 38,
      sink: 0.25, // 가까운 띠와 겹치는 자리에서 아른거리지 않게
      horizonColor: SKY_STYLE.horizon,
    });
    const { heightAt, haze } = nearFields;
    return {
      // 무대 밖 들판 높이 — 연결로가 어디에 내려앉을지 알아야 한다
      fieldHeight: heightAt,
      fields: nearFields.geometry,
      farFields: farFields.geometry,
      forestVillages: buildForestVillages({
        core: CORE,
        river: RIVER,
        heightAt,
        haze,
        noise,
        forestCount: T.forestCount,
        houseCount: T.villageHouseCount,
        taekchonCount: T.taekchonHouseCount,
        horizonColor: SKY_STYLE.horizon,
      }),
      mountains: buildMountainRidges({ noise, horizonColor: SKY_STYLE.horizon, heightAt: farFields.heightAt }),
    };
  }, [T.distantLandscape, T.forestCount, T.villageHouseCount, T.taekchonHouseCount]);
  useEffect(
    () => () => {
      distant?.fields?.dispose();
      distant?.farFields?.dispose();
      distant?.forestVillages?.geometry?.dispose();
      distant?.mountains?.dispose();
    },
    [distant],
  );

  const skyGeometry = useMemo(() => (T.skyDome ? buildSkyDome() : null), [T.skyDome]);
  const cloudGeometry = useMemo(() => (T.cloudCount > 0 ? buildClouds({ count: T.cloudCount }) : null), [T.cloudCount]);
  useEffect(() => () => skyGeometry?.dispose(), [skyGeometry]);
  useEffect(() => () => cloudGeometry?.dispose(), [cloudGeometry]);
  const skyRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);

  // 풀 — 밟고 지나가야 해서 충돌이 없고 키가 낮다.
  const grass = useMemo(() => {
    if (T.grassDensity <= 0) return null;
    const clumpNoise = createNoise(707171);
    const meshes: THREE.BufferGeometry[] = [];
    // Z3(사건 현장)도 맨 암반이면 죽은 땅으로 보인다 — 아주 성글게 깐다
    const density: Record<string, number> = { Z4: 1, Z1: 0.35, Z3: 0.22 };
    const seeds: Record<string, number> = { Z4: 31771, Z1: 55219, Z3: 90311 };
    for (const code of ["Z4", "Z1", "Z3"]) {
      const zone = terrain.zones.find((v) => v.code === code)!;
      const geometry = buildGrass({
        x: zone.x,
        z: zone.z,
        elevation: zone.elevation,
        // 나루터는 밟혀서, 바위 위는 흙이 얕아서 풀이 적다
        density: T.grassDensity * (density[code] ?? 0.3),
        seed: seeds[code] ?? 12345,
        clumpNoise,
        canPlace: (x, zz) => !terrain.groundAt(x, zz).path && !terrain.blockedAt(x, zz, zone.elevation, 0.5),
      });
      if (geometry) meshes.push(geometry);
    }
    // 코어 바깥 20 m 띠 — 비면 「무대 끝」이 선으로 보인다.
    const margin = 22;
    const band = buildGrass({
      x: [CORE.x[0] - margin, CORE.x[1] + margin],
      z: [CORE.z[0] - margin, CORE.z[1] + margin],
      elevation: 0,
      density: T.grassDensity * 0.5,
      seed: 44117,
      clumpNoise,
      canPlace: (x, z) => {
        const isInside = x > CORE.x[0] && x < CORE.x[1] && z > CORE.z[0] && z < CORE.z[1];
        return !isInside && z < RIVER.zStart - 1;
      },
    });
    if (band) meshes.push(band);
    return meshes;
  }, [terrain, T.grassDensity]);
  useEffect(() => () => grass?.forEach((g) => g.dispose()), [grass]);

  // 사람 — 척도용 회색 사람 셋은 모두 진짜 인물로 바뀌어 자리가 비었다. 절벽 높이를 다시 잴 때 여기에 자리를 도로 적는다.
  const people = useMemo(() => {
    const scaleSpots: [number, number, number, number, string][] = [];
    return {
      scaleFigures:
        T.showHumanScale && scaleSpots.length
          ? buildPeople(
              scaleSpots.map(([x, z, heading, height, clothes]) => ({
                height,
                x,
                z,
                y: terrain.groundAt(x, z).y,
                heading,
                clothes,
              })),
            )
          : null,
      npc: buildPeople([
        {
          height: 1.62,
          x: NPC.x,
          z: NPC.z,
          y: terrain.groundAt(NPC.x, NPC.z).y,
          heading: Math.PI * 0.15,
          clothes: NPC.color,
        },
      ]),
    };
  }, [terrain, T.showHumanScale]);
  useEffect(
    () => () => {
      people.scaleFigures?.dispose();
      people.npc?.dispose();
    },
    [people],
  );

  // 나룻배 — 배가 있어야 「여기서 강을 건넌다」가 읽힌다. 하나뿐이어도 편집기로 옮기려고 무리로 넣는다.
  const ferryShape = useMemo(() => (T.ferryBoat ? ferryBoatPrototype() : null), [T.ferryBoat]);
  useEffect(() => () => ferryShape?.dispose(), [ferryShape]);
  const ferrySpot = useMemo<Spot | null>(() => {
    if (!T.ferryBoat) return null;
    const z1 = terrain.zones.find((v) => v.code === "Z1")!;
    return {
      x: z1.x[0] + 11.4, // 나루(X+4.5~+9.5) 바로 동쪽
      y: -0.13, // 물높이 0 에서 그만큼 잠긴다
      z: RIVER.zStart + 3.0,
      size: 4.4, // 실제 길이(m)
      rotation: 0.1,
    };
  }, [terrain, T.ferryBoat]);

  // 통로 T1~T4
  const pathShapes = useMemo(() => {
    if (!T.pathDetail) return null;
    const noise = createNoise(133707);
    // 비탈 발치가 닿을 땅 — 구역 고도(평평한 값)를 쓰면 요철 자리에서 비탈 끝이 뜨거나 묻힌다.
    const groundHeight = (x: number, z: number) => ground.surface.heightAt(x, z);
    const built = terrain.measuredPaths.map((path) =>
      buildPaths({
        path,
        shoulderWidth: T.shoulderWidth,
        shoulderDrop: T.shoulderDrop,
        // 절벽과 같은 손잡이를 넘긴다 — 한 공간의 재질로 보이려면 함께 움직여야 한다.
        slopeCarveDepth: T.slopeCarveDepth,
        strataThickness: T.strataThickness * 0.65, // 흙비탈은 지층이 더 촘촘하다
        angularity: T.angularity,
        noise,
        groundHeight,
        // 비탈 치마가 다른 길을 덮지 않게 한다. 코드로 가르면 안 된다 — T4 스위치백은 위·아래 다리가 같은 T4 다.
        otherPathAt: (x, z) => {
          const sample = terrain.groundAt(x, z);
          return !!sample?.path && !sample.isShoulder;
        },
      }),
    );
    return {
      built,
      // 절벽과 같은 돌을 비탈에 흩어 두 재질이 서로 물려 들어가게 한다
      slopeRockSpots: T.slopeDecor ? built.flatMap((v) => v.decor.rocks) : [],
      // 비탈 옆면은 기둥 없는 잎더미 자리 — 비스듬한 면에 기둥을 세우면 막대가 튀어나온다
      slopeShrubSpots: T.slopeDecor ? built.flatMap((v) => v.decor.bushes) : [],
      // T1 「바위틈」 — 길 양옆의 큰 바위
      crevasseRockSpots: built.flatMap((v) => v.decor.crevasseRocks),
      // 지오메트리가 아니라 자리 — 길 위의 돌 하나를 집어 치울 수 있어야 한다
      stoneSpots: roadsideStoneSpots({
        lines: built.map((v, i) => ({ centerline: v.centerline, halfWidth: terrain.measuredPaths[i].width / 2 })),
        density: T.roadsideStones,
        seed: 90211,
        shoulderWidth: T.shoulderWidth,
        groundHeight,
      }),
    };
  }, [
    terrain,
    ground,
    T.pathDetail,
    T.shoulderWidth,
    T.shoulderDrop,
    T.slopeCarveDepth,
    T.strataThickness,
    T.angularity,
    T.roadsideStones,
    T.slopeDecor,
  ]);
  useEffect(
    () => () => {
      pathShapes?.built.forEach((v) => {
        v.path?.dispose();
        v.slope?.dispose();
      });
    },
    [pathShapes],
  );

  // 편집 모드(E) — Leva 항목이 135 개라 아무도 못 찾아 키로 뺐다. setter 가 없어 Leva 와 같이 두면 진실이 둘이 된다.
  const [isEditing, setIsEditing] = useState(false);
  // 편집 중 공중에서 내려다보기(Tab). 편집을 끄면 같이 내려온다.
  const [isOverview, setIsOverview] = useState(false);
  // 캐릭터 GLB 는 15 MB 가 넘는다 — 처음 V 를 누를 때 붙이고, 한 번 붙으면 계속 붙어 있다.
  const [isAvatarMounted, setIsAvatarMounted] = useState(isThirdPerson);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 커밋 뒤에 붙여야 1인칭 첫 화면이 캐릭터를 기다리지 않는다
    if (isThirdPerson) setIsAvatarMounted(true);
  }, [isThirdPerson]);
  // 그림자 갱신을 아끼는 동안 늦게 붙은 캐릭터는 그림자 맵에 없다 — 붙는 순간 한 번 흔든다.
  useEffect(() => {
    if (isAvatarMounted) requestShadowUpdates(2);
  }, [isAvatarMounted, isThirdPerson]);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "KeyE" && !e.repeat && !e.ctrlKey && !e.metaKey)
        setIsEditing((v) => {
          if (v) setIsOverview(false);
          return !v;
        });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 3인칭 중 좌클릭은 잽/크로스. 패널·Leva 를 누른 클릭은 공격으로 치지 않는다.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!active || !isThirdPerson || isEditing || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button, input, select, label, [role='slider']"))
        return;
      const state = playerState.current;
      const serial = (state.attackSerial ?? 0) + 1;
      state.attackSerial = serial;
      state.attackMotion = serial % 2 === 1 ? "Punch_Jab" : "Punch_Cross";
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [active, isThirdPerson, isEditing]);

  // 편집 층 — assets/edits.json 을 읽어 생성 결과 위에 덧씌운다.
  const [edits, setEdits] = useState(emptyEdits);
  useEffect(() => {
    loadEdits().then(setEdits);
  }, []);

  // 손으로 깎은 것 ↔ Meshy 모형은 성격이 달라 눈으로 보고 고른다(모형자연).
  const prototypes = useMemo<NajuPrototypes>(
    () => ({
      trees: T.bakedNature ? treeModels() : treePrototypes(5, 9001),
      shrubs: T.bakedNature ? bushModels() : shrubPrototypes(5, 9003),
      // 손으로 깎은 잎더미는 이제 안 쓴다. 모형자연을 끄면 옛 그림으로 돌아가야 해서 남긴다.
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
      // 색까지 구워 온 모형이 있으면 그것을 쓴다(눈·혀를 기하로 추측해 칠하던 옛 표본보다 낫다).
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

  // 씬 요소 — 무리 id 가 전부 `씬N.` 으로 시작해 씬 상태 장치가 앞머리만 보고 켜고 끌 수 있다.
  const scene1 = useGroundSpots(T.scene1Props, ground, scene1Spots);
  const scene2 = useGroundSpots(T.scene2Props, ground, scene2Spots);
  const scene3 = useGroundSpots(T.scene3Props, ground, scene3Spots);
  const scene4 = useGroundSpots(T.scene4Props, ground, scene4Spots);
  const scene5 = useGroundSpots(T.scene5Props, ground, scene5Spots);

  // 택촌 나루터 — 강 건너 물가에 한 채. 표본은 국소 +Z 로 뻗으므로 반 바퀴 돌린다.
  const farLandingSpots = useMemo<Spot[]>(() => {
    if (!distant?.fieldHeight) return [];
    const x = 41; // 택촌 한복판(실측 x 7~75)
    const waterEdge = RIVER.zStart + RIVER.farBankWidth + 3 + farBankBendAt(x);
    return [
      {
        x,
        y: distant.fieldHeight(x, waterEdge + 1),
        z: waterEdge + 0.6, // 물가에서 뭍 쪽으로 조금 물린다
        size: 4.1, // Z1 나루터와 같은 크기
        rotation: Math.PI,
      },
    ];
  }, [distant]);

  // 10 m 격자 — 도면 대조용 눈금이라 코어 사각형 안에만 긋는다(80 × 80 이면 강 위로 삐져나가 택촌을 가렸다).
  const gridGeometry = useMemo(() => {
    const points: number[] = [];
    const y = 0.08 * U;
    for (let x = CORE.x[0]; x <= CORE.x[1] + 1e-6; x += 10)
      points.push(x * U, y, CORE.z[0] * U, x * U, y, CORE.z[1] * U);
    for (let z = CORE.z[0]; z <= CORE.z[1] + 1e-6; z += 10)
      points.push(CORE.x[0] * U, y, z * U, CORE.x[1] * U, y, z * U);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }, []);
  useEffect(() => () => gridGeometry.dispose(), [gridGeometry]);

  // 연결로 — 코어 동쪽 가장자리는 들판보다 6.7 m 높다. 그 턱을 잇는다.
  const ramp = useMemo(() => {
    if (!T.connectorRamp || !ground?.surface || !distant?.fieldHeight) return null;
    return buildConnectorRamp({
      // 묻는 점을 코어 안으로 물려야 surface → groundAt → 연결로 → surface 고리가 안 닫힌다(닫히면 스택이 터진다).
      coreHeight: (x, z) => {
        const cx = Math.min(Math.max(x, CORE.x[0] + 0.5), CORE.x[1] - 0.5);
        const cz = Math.min(Math.max(z, CORE.z[0] + 0.5), CORE.z[1] - 0.5);
        return ground.surface.heightAt(cx, cz);
      },
      outerHeight: distant.fieldHeight,
    });
  }, [T.connectorRamp, ground, distant]);
  useEffect(() => () => ramp?.geometry?.dispose(), [ramp]);
  // 판정 쪽에 끼운다 — 그림과 걷는 높이가 같은 함수를 봐야 어긋나지 않는다.
  useEffect(() => {
    terrain.setRamp(ramp);
    return () => terrain.setRamp(null);
  }, [terrain, ramp]);
  // 무대 밖 지면 — 없으면 코어 밖이 전부 y = 0 이라 연결로를 내려가도 들판보다 뜬 자리에 선다.
  useEffect(() => {
    terrain.setOuterGround(distant?.fieldHeight ?? null);
    return () => terrain.setOuterGround(null);
  }, [terrain, distant]);

  // 낭떠러지 쪽 울타리 — 낙차를 재서 세운다. 막지는 않는다(헛디디면 떨어지는 것이 이 공간의 사건이다).
  const fences = useMemo(() => {
    if (!T.fences || !ground?.surface) return null;
    return fenceSpots({
      measuredPaths,
      groundHeight: (x, z) => ground.surface.heightAt(x, z),
      minDrop: T.fenceMinDrop,
    });
  }, [T.fences, T.fenceMinDrop, measuredPaths, ground]);

  // 길 양옆 수풀 — 실제 산길은 양옆이 가장 빽빽하다.
  const roadside = useMemo(() => {
    if (!T.roadsideBushes) return null;
    return roadsideBushSpots({
      measuredPaths: terrain.measuredPaths,
      surface: ground.surface,
      terrain,
      shoulderEdge: SHOULDER_DEFAULTS.reach * T.shoulderWidth,
      margin: T.roadsideMargin,
      band: T.roadsideBand,
      spacing: T.roadsideDensity,
    });
  }, [terrain, ground, T.roadsideBushes, T.roadsideMargin, T.roadsideBand, T.roadsideDensity, T.shoulderWidth]);

  const hill = useMemo(() => {
    if (!T.hillVegetation) return null;
    const noise = createNoise(818221);
    return scatterBushes({
      terrain,
      surface: ground.surface,
      core: CORE,
      treeCount: T.hillTreeCount,
      shrubCount: T.hillShrubCount,
      noise,
    });
  }, [terrain, ground, T.hillVegetation, T.hillTreeCount, T.hillShrubCount]);

  const instanceGroups = useMemo(
    () =>
      buildInstanceGroups({
        edits,
        prototypes,
        bakedNature: T.bakedNature,
        groundAt: terrain.groundAt,
        treeBeltSpots: blockerShapes?.pieces?.find((b) => b.code === "수목대")?.treeSpots ?? null,
        hill,
        roadside,
        paths: pathShapes,
        footScreeSpots: blockerShapes?.footScreeSpots ?? null,
        fences,
        distant,
        farLandingSpots,
        steppingStones,
        scene1,
        scene2,
        scene3,
        scene4,
        scene5,
        serpent: bakedSerpent,
        abisa: bakedAbisa,
        fisher: bakedFisher,
        fisher2: bakedFisher2,
        fisher3: bakedFisher3,
        pebbleSpots: ground?.pebbleSpots ?? [],
        cliff: cliffPieces,
        ferryBoat: ferrySpot && ferryShape ? { spot: ferrySpot, shape: ferryShape } : null,
      }),
    [
      hill,
      roadside,
      pathShapes,
      blockerShapes,
      cliffPieces,
      ferrySpot,
      ferryShape,
      fences,
      distant,
      farLandingSpots,
      scene1,
      scene2,
      scene3,
      scene4,
      scene5,
      steppingStones,
      prototypes,
      edits,
      bakedSerpent,
      bakedAbisa,
      bakedFisher,
      bakedFisher2,
      bakedFisher3,
      T.bakedNature,
      ground,
      terrain,
    ],
  );

  // 영산강 — 수면은 코어 밖까지 넓게 깐다. 물 끝이 보이면 '판'으로 읽힌다.
  const river = useMemo(() => {
    if (!T.riverDetail) return null;
    const noise = createNoise(660411);
    return {
      // 좁게 끊으면 들판이 물 위로 삐져나오고 강이 아니라 연못으로 보인다.
      surface: buildRiverSurface({
        x: [-400, 480],
        zStart: RIVER.zStart,
        zEnd: RIVER.zStart + RIVER.farBankWidth + 3,
        cellsPerMeter: 0.25,
        waveHeight: T.waveHeight,
      }),
      stones: buildRiverbank({
        x: CORE.x,
        zStart: RIVER.zStart,
        count: T.bankStoneCount,
        seed: 40551,
        // Z1·Z2 가 물가까지 내려와 있다 — 통로 위에는 놓지 않는다
        canPlace: (x, zz) => !terrain.groundAt(x, zz).path,
      }),
      // 택촌 뒤 16 m. 강폭이나 택촌이 옮겨 가도 따라온다.
      farBank: T.showFarBank
        ? buildFarBank({
            x: [-260, 340],
            z: RIVER.zStart + RIVER.farBankWidth + 60,
            layers: 2,
            noise,
            horizonColor: SKY_STYLE.horizon,
          })
        : null,
    };
  }, [terrain, T.riverDetail, T.waveHeight, T.bankStoneCount, T.showFarBank]);
  useEffect(
    () => () => {
      river?.farBank?.dispose();
      river?.surface?.geometry?.dispose();
      river?.stones?.dispose();
    },
    [river],
  );

  // FOV 는 카메라에 직접 건다
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.fov = T.fov;
    camera.updateProjectionMatrix();
  }, [camera, T.fov]);

  // useFrame 은 렌더 전에 돈다. 자동 리셋이면 그 직후 값이 지워져 계기판에 0 만 찍힌다 — 직접 리셋한다.
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  // 이동 — 시작은 V1. 편집 중에도 WASD 는 살아 있어야 「보면서 옮기기」가 된다.
  const propColliders = useMemo(() => buildPropColliders(instanceGroups), [instanceGroups]);
  const cameraOccluders = useMemo(() => buildCameraOccluders(instanceGroups), [instanceGroups]);
  useEffect(() => {
    if (import.meta.env.DEV) exposeDevHook("propColliders", propColliders);
  }, [propColliders]);
  const teleport = useTerrainMovement(active || isEditing, {
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

  // 밖에서 만들어 온 바위(assets/rocks/*.glb)
  const [rockAsset, setRockAsset] = useState<Awaited<ReturnType<typeof loadRock>>>(null);
  useEffect(() => {
    let isAlive = true;
    if (!T.rockAsset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 끄면 읽어 둔 바위를 버려야 다시 켤 때 새로 읽는다
      setRockAsset(null);
      return;
    }
    loadRock({ widthMeters: T.rockAssetWidth })
      .then((rock) => {
        if (!isAlive) return;
        setRockAsset(rock);
        if (!rock && ROCK_FILES.length === 0) console.info("assets/rocks/ 에 .glb 가 없다 — 넣으면 자동으로 잡힌다");
      })
      .catch((e: unknown) => console.warn("바위 에셋을 못 읽었다:", e));
    return () => {
      isAlive = false;
    };
  }, [T.rockAsset, T.rockAssetWidth]);

  // 구운 지형 텍스처 — 재질만 바꾸므로 판정 숫자는 안 변한다.
  useEffect(() => {
    applyBakedTerrainTexture(scene, T.bakedTerrainTexture).catch((e: unknown) =>
      console.warn("구운 지형 텍스처를 못 입혔다:", e),
    );
  }, [scene, T.bakedTerrainTexture]);

  // 씬이 끝나면 그 씬 동안 가리던 차단물을 치운다(§4). 씬 진행 장치가 생기면 거기서 endScene 을 부른다.
  const [clearedBlockers, setClearedBlockers] = useState<Set<string>>(() => new Set());
  const collapseRef = useRef<CollapseSequence | null>(null);
  // reportRef.current 는 걷기 훅이 매 프레임 새 객체로 갈아끼운다 — 알림은 ref 에 들고 매 프레임 다시 싣는다.
  const collapseNoticeRef = useRef("");
  const [collapse, setCollapse] = useState<CollapseState | null>(null);

  // 지형이 다시 만들어져도 치운 상태는 유지한다 — 판정 쪽 집합은 지형과 함께 새로 생긴다.
  useEffect(() => {
    if (!terrain?.clearedBlockers) return;
    terrain.clearedBlockers.clear();
    for (const code of clearedBlockers) terrain.clearedBlockers.add(code);
  }, [terrain, clearedBlockers]);

  const endScene = useCallback(
    (sceneNumber: number) => {
      if (collapseRef.current && !collapseRef.current.isDone) return "연출 중이다";
      const target = blockerShapes?.pieces?.find(
        (b) => b.clearing?.scene === sceneNumber && !clearedBlockers.has(b.code),
      );
      if (!target || !target.clearing) return `씬 ${sceneNumber} 에 치울 차단물이 없다`;
      collapseRef.current = createCollapseSequence({
        blocker: target,
        lookAt: target.clearing.lookAt,
        message: target.clearing.message,
        groundHeight: (x, z) => ground?.surface?.heightAt(x, z) ?? 0,
        onClear: () => setClearedBlockers((s) => new Set(s).add(target.code)),
        onNotify: (text) => {
          collapseNoticeRef.current = text;
        },
      });
      setCollapse({ code: target.code, progress: 0 });
      return `${target.code} ${target.name} 치우는 중`;
    },
    [blockerShapes, clearedBlockers, ground],
  );

  // 개발용 — 헤드리스 스크린샷·콘솔이 쓴다. teleport 를 쓰므로 useTerrainMovement 뒤여야 한다.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    exposeDevHook("naju", {
      camera,
      gl,
      scene,
      terrain,
      controls: T,
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
      groundCellRect,
      zoneList: () => terrain.zones.map((z) => ({ code: z.code, x: z.x, z: z.z })),
      // 밑그림 아틀라스를 캔버스로 — 색 대조용
      underpaint: (size = 2048) => {
        const collected = collectTerrain(scene, { vertexColors: true });
        if (!collected) throw new Error("밑그림을 구울 지형 메시가 없다");
        return bakeUnderpaint(gl, collected.geometry, size);
      },
      assets: { parseGlb, firstMesh, fitRealSize },
      // 도구가 Leva 를 안 거치고 구운 텍스처를 껐다 켠다
      bakedTerrain: (enabled: boolean) => applyBakedTerrainTexture(scene, enabled),
    });
  }, [camera, gl, scene, terrain, T, teleport, endScene, clearedBlockers, ramp]);

  // 프레임 시간 — 평균 60 이어도 가끔 120 ms 가 끼면 끊겨 보인다. 최근 120 프레임의 평균과 가장 느린 프레임을 같이 낸다.
  const frameTimes = useRef(new Float32Array(120));
  const frameSlot = useRef(0);
  const frameCount = useRef(0);

  // 반드시 useTerrainMovement 뒤에 등록돼야 한다 — 그 훅이 매 프레임 reportRef.current 를 갈아끼운다.
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
      const shift = distortion.waterShift ? waterDistortion(distortion.waterShift) : null;
      river.surface.update(state.clock.elapsedTime * T.waveSpeed, shift);
      setGrainStrength(T.groundGrain, T.groundRockGrain);
      // 잔결도 같은 어긋남을 받아야 위화감이 반만 오지 않는다
      rippleHandle.current?.update(state.clock.elapsedTime * T.waveSpeed, shift, T.waterRipple);
    }
    const report = reportRef.current;
    if (report) {
      report.collapseStage = collapseNoticeRef.current;
      report.triangles = gl.info.render.triangles;
      // 지금 보는 땅이 어느 쪽인지 계기판에 박아 둔다 — 「차이가 미미하다」와 「안 바뀌었다」를 가린다.
      report.terrainSource = !T.useBlenderTerrain
        ? "옛(코드)"
        : bakedTerrain.status === "ready"
          ? "새(블렌더)"
          : bakedTerrain.status === "loading"
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

  // 개발용 — 숫자키 V1~V3 텔레포트(§4 시야 검증), Shift+숫자 = 그 씬이 끝났다. IME 때문에 e.code 를 쓴다.
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
  }, [teleport, endScene]);

  // 통로를 조각으로 펼친다(길디테일을 끈 리본)
  const pathSegments = useMemo(
    () =>
      measuredPaths.flatMap((t) =>
        t.segments.map((s, i) => {
          const elevationAt = (distance: number) => t.startElevation + t.rise * (distance / t.planarLength);
          return {
            key: `${t.code}-${i}`,
            a: [s.x1, s.z1, elevationAt(s.startDistance)] as PlanPoint,
            b: [s.x2, s.z2, elevationAt(s.startDistance + s.length)] as PlanPoint,
            width: t.width,
          };
        }),
      ),
    [measuredPaths],
  );

  // 통로를 받치는 흙더미 — 1.5 m 마다 상자를 세워 하나로 합친다(드로우콜 1).
  const embankment = useMemo(() => {
    const boxes: MergeBox[] = [];
    for (const t of measuredPaths) {
      if (t.rise === 0) continue; // 평지 통로(T1)는 받칠 것이 없다
      for (const s of t.segments) {
        const n = Math.max(1, Math.round(s.length / 1.5));
        const angle = Math.atan2(s.x2 - s.x1, s.z2 - s.z1);
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n;
          const arc = s.startDistance + (s.length * (i + 0.5)) / n;
          const y = t.startElevation + t.rise * (arc / t.planarLength) - 0.3; // 길 판 아래까지만
          if (y < 0.4) continue;
          boxes.push({
            size: [(t.width + 1.2) * U, y * U, (s.length / n + 0.15) * U],
            position: [(s.x1 + (s.x2 - s.x1) * f) * U, (y / 2) * U, (s.z1 + (s.z2 - s.z1) * f) * U],
            rotation: [0, angle, 0],
          });
        }
      }
    }
    return mergeBoxes(boxes);
  }, [measuredPaths]);
  useEffect(() => () => embankment?.dispose(), [embankment]);

  // 해가 바라보는 지점 — 그림자 카메라를 맞춘다
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const sunRef = useRef<THREE.DirectionalLight>(null);

  // 해의 자리 — 코어 한가운데(40, 25)에서 방위·고도만큼. X = 동(+) · Z = 남(+).
  const sunPosition = useMemo(() => {
    const distance = 130; // m
    const a = (T.sunAzimuth * Math.PI) / 180;
    const e = (T.sunElevation * Math.PI) / 180;
    return planPoint(
      40 + distance * Math.cos(e) * Math.sin(a),
      25 - distance * Math.cos(e) * Math.cos(a),
      distance * Math.sin(e),
    );
  }, [T.sunAzimuth, T.sunElevation]);

  // 그림자 카메라를 사람 곁으로 옮긴다(±70 이면 텍셀이 촘촘해지고 그림자 맵에 들 물건도 준다).
  // 텍셀 격자에 스냅하지 않으면 걸을 때 그림자 가장자리가 지글거린다.
  const sunFollow = useRef({ x: 0, z: 0 });
  useFrame(() => {
    const light = sunRef.current;
    if (!light || !T.shadows) return;
    const texel = (T.shadowRange * 2) / 4096;
    const cx = Math.round(camera.position.x / texel) * texel;
    const cz = Math.round(camera.position.z / texel) * texel;
    const last = sunFollow.current;
    if (cx === last.x && cz === last.z) return;
    last.x = cx;
    last.z = cz;
    sunTarget.position.set(cx, sunTarget.position.y, cz);
    sunTarget.updateMatrixWorld();
    // 빛은 목표에서 같은 방향·같은 거리 — 해의 각도는 안 바뀐다
    light.position.set(sunPosition.x + cx - 40 * U, sunPosition.y, sunPosition.z + cz - 25 * U);
    // 서 있는 동안은 그림자 맵을 안 그린다. 걷는 동안 매 프레임 그리지 않게 관리자가 간격을 둔다.
    requestShadowUpdates(0.25);
  });

  const coreWidth = CORE.x[1] - CORE.x[0];
  const coreDepth = CORE.z[1] - CORE.z[0];

  return (
    <>
      <ShadowManager enabled={T.shadows && T.throttleShadowUpdates} urgentInterval={3} slowInterval={240} />
      {/* 재질을 처음 그리는 순간 셰이더를 컴파일한다(수백 ms). GLB 가 늦게 붙으므로 주기적으로 데운다. */}
      <ShaderWarmup />
      <color attach="background" args={[T.skyColor]} />
      {/* 하늘돔 — 빛도 안개도 안 타고 가장 먼저 그려 깊이 버퍼를 안 쓴다 */}
      {skyGeometry && (
        <mesh name={MESH_NAMES.skyDome} ref={skyRef} geometry={skyGeometry} renderOrder={-1} frustumCulled={false}>
          <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {T.fog && <fog attach="fog" args={[T.skyColor, T.fogNear * U, T.fogFar * U]} />}
      <ambientLight intensity={T.ambientIntensity * T.brightness} />
      {/* 하늘빛 — 얕은 굴곡에서도 면 방향이 갈려 보이게 한다 */}
      <hemisphereLight
        args={[T.hemisphereSkyColor, T.hemisphereGroundColor, T.hemisphereIntensity * T.brightness]}
        position={[0, 1, 0]}
      />
      <primitive object={sunTarget} position={planPoint(40, 25, 0)} />
      {/* 그림자 카메라는 사람을 따라다닌다. ±70 을 2048² 로 덮으면 텍셀 6.8 cm. */}
      <directionalLight
        ref={sunRef}
        castShadow={T.shadows}
        target={sunTarget}
        position={sunPosition}
        intensity={T.sunIntensity * T.brightness}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-T.shadowRange}
        shadow-camera-right={T.shadowRange}
        shadow-camera-top={T.shadowRange}
        shadow-camera-bottom={-T.shadowRange}
        shadow-camera-near={1}
        shadow-camera-far={900}
        {...shadowBias}
      />

      {cloudGeometry && (
        <mesh
          name={MESH_NAMES.skyClouds}
          ref={cloudRef}
          geometry={cloudGeometry}
          renderOrder={-1}
          frustumCulled={false}
        >
          <meshBasicMaterial vertexColors fog={false} depthWrite={false} toneMapped={false} />
        </mesh>
      )}

      {/* 원경 — 산은 빛을 안 받는 실루엣, 들·숲·마을은 빛을 받는다 */}
      {distant && (
        <>
          <mesh name={MESH_NAMES.distantMountains} geometry={distant.mountains} frustumCulled={false}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
          <mesh name={MESH_NAMES.distantFields} geometry={distant.fields} receiveShadow>
            <GroundMaterial shading={shading} brightness={T.brightness} doubleSided />
          </mesh>
          {/* 먼 대지 — 비면 들판이 260 m 에서 끊기고 하늘이 비쳐 다시 '섬'이 된다 */}
          <mesh name={MESH_NAMES.distantFarFields} geometry={distant.farFields} frustumCulled={false}>
            <GroundMaterial shading={shading} brightness={T.brightness} doubleSided />
          </mesh>
          {distant.forestVillages?.geometry && (
            <mesh name={MESH_NAMES.distantForestVillages} geometry={distant.forestVillages.geometry}>
              <GroundMaterial shading={shading} brightness={T.brightness} />
            </mesh>
          )}
        </>
      )}

      {/* 땅 밑받침 — 두께 없는 땅 가장자리·틈으로 뒤가 비치지 않게 */}
      <mesh position={planPoint(coreWidth / 2, coreDepth / 2, -0.9 - maxDip)} receiveShadow>
        <boxGeometry args={[coreWidth * U, 1.2 * U, coreDepth * U]} />
        <meshToonMaterial color={shade("#2E323A")} gradientMap={TOON_GRADIENT} />
      </mesh>

      {river ? (
        <>
          {/* 건너편 능선은 원경이라 빛을 안 받는다 — 음영을 주면 오히려 가깝게 보인다 */}
          {river.farBank && (
            <mesh name={MESH_NAMES.riverFarBank} geometry={river.farBank}>
              <meshBasicMaterial vertexColors toneMapped={false} />
            </mesh>
          )}
          {/* 수면 재질에만 ref 를 단다 — 재질이 바뀌어도 잔결이 다시 걸린다 */}
          <mesh name={MESH_NAMES.riverSurface} geometry={river.surface.geometry} receiveShadow>
            <GroundMaterial shading={shading} brightness={T.brightness} materialRef={rippleMaterialRef} />
          </mesh>
          {river.stones && (
            <mesh name={MESH_NAMES.riverStones} geometry={river.stones} receiveShadow castShadow>
              <GroundMaterial shading={shading} brightness={T.brightness} />
            </mesh>
          )}
        </>
      ) : (
        <mesh position={planPoint(coreWidth / 2, (RIVER.zStart + RIVER.zEnd) / 2, -0.35)} receiveShadow>
          <boxGeometry args={[coreWidth * U, 0.35 * U, (RIVER.zEnd - RIVER.zStart) * U]} />
          <meshToonMaterial color={shade(T.riverColor)} gradientMap={TOON_GRADIENT} />
        </mesh>
      )}
      {T.showLabels && (
        <Label position={planPoint(70, 47, 1)} color="#BFE0F2">
          {RIVER.name} · 방향 앵커(§4)
        </Label>
      )}

      {T.showLabels &&
        zones.map((z) => (
          <Label
            key={`zone-${z.code}`}
            position={planPoint((z.x[0] + z.x[1]) / 2, (z.z[0] + z.z[1]) / 2, z.elevation + 2.2)}
          >
            {z.code} {z.name} · {z.dimensionsLabel} · {z.scenes}
          </Label>
        ))}

      {/* 블렌더가 구운 땅 — GLB 는 도면 미터라 scale 이 전부다. castShadow 는 116 → 40 fps 라 주지 않는다. */}
      {isBakedTerrainOn && (
        <mesh name={MESH_NAMES.ground} geometry={bakedTerrain.geometry ?? undefined} scale={U} receiveShadow>
          <GroundMaterial shading={shading} brightness={T.brightness} grain grainEnabled={T.groundGrain > 0} />
        </mesh>
      )}
      {!isBakedTerrainOn && ground.mesh && (
        <mesh name={MESH_NAMES.ground} geometry={ground.mesh} receiveShadow>
          <GroundMaterial shading={shading} brightness={T.brightness} grain grainEnabled={T.groundGrain > 0} />
        </mesh>
      )}

      {grass?.map((g, i) => (
        <mesh name={MESH_NAMES.grass} key={`grass-${i}`} geometry={g} receiveShadow>
          <GroundMaterial shading={shading} brightness={T.brightness} doubleSided />
        </mesh>
      ))}

      {/* 절벽 — 끄면 민판 한 장으로 돌아가 「매끈한 판은 높이가 안 읽힌다」를 바로 비교한다 */}
      {cliffPieces ? (
        <>
          {/* 새 땅에는 절벽도 들어 있어 같이 그리면 z 싸움을 한다. 닫힌 덩어리라 양면이어야 검은 쐐기가 안 난다. */}
          {!isBakedTerrainOn && (
            <mesh name={MESH_NAMES.cliffFace} geometry={cliffPieces.face} receiveShadow castShadow>
              <GroundMaterial
                shading={shading}
                brightness={T.brightness}
                doubleSided
                grain
                grainEnabled={T.groundGrain > 0}
              />
            </mesh>
          )}
          {cliffPieces.scree && (
            <mesh name={MESH_NAMES.cliffScree} geometry={cliffPieces.scree} receiveShadow castShadow>
              <GroundMaterial shading={shading} brightness={T.brightness} />
            </mesh>
          )}
          {rockAsset && (
            <mesh
              name={MESH_NAMES.rockAsset}
              geometry={rockAsset.geometry}
              position={planPoint(T.rockAssetX, T.rockAssetZ, T.rockAssetY)}
              rotation={[0, (T.rockAssetRotation * Math.PI) / 180, 0]}
              receiveShadow
              castShadow
            >
              <GroundMaterial shading={shading} brightness={T.brightness} doubleSided />
            </mesh>
          )}
        </>
      ) : (
        <SlopeSegment
          a={[(cliff.x[0] + cliff.x[1]) / 2, cliff.zTop, cliff.height]}
          b={[(cliff.x[0] + cliff.x[1]) / 2, cliff.zBottom, 0]}
          width={cliff.x[1] - cliff.x[0]}
          thickness={0.6}
          color={shade(T.cliffColor)}
          outline={outline}
        />
      )}
      {T.showLabels && (
        <Label position={planPoint(45, 28, 7)} color="#E8DCC0">
          {cliff.name} H = {cliff.height} m · 실각 {cliff.slopeAngle.toFixed(0)}°
        </Label>
      )}

      {/* 통로 — 끄면 노란 리본. 걷는 폭은 도면 그대로, 갓길·비탈은 그 바깥으로만 낸다. */}
      {pathShapes ? (
        <>
          {/* 새 땅에는 길이 파여 있어 리본을 얹으면 z 싸움이 난다 */}
          {!isBakedTerrainOn &&
            pathShapes.built.map((v, i) => (
              <group key={`path-${measuredPaths[i].code}`}>
                {v.slope && (
                  <mesh name={MESH_NAMES.slope} geometry={v.slope} receiveShadow castShadow>
                    <GroundMaterial
                      shading={shading}
                      brightness={T.brightness}
                      doubleSided
                      grain
                      grainEnabled={T.groundGrain > 0}
                    />
                  </mesh>
                )}
                {/* 단면 — 양면이면 아래에서 올려다볼 때 빛 못 받는 밑면이 세로 검은 띠로 나온다 */}
                <mesh name={MESH_NAMES.path} geometry={v.path} receiveShadow>
                  <GroundMaterial
                    shading={shading}
                    brightness={T.brightness}
                    grain="path"
                    grainEnabled={T.groundGrain > 0}
                  />
                </mesh>
              </group>
            ))}
        </>
      ) : (
        <>
          {embankment && (
            <mesh name={MESH_NAMES.pathEmbankment} geometry={embankment} receiveShadow castShadow>
              <meshToonMaterial color={shade(T.cliffColor)} gradientMap={TOON_GRADIENT} />
            </mesh>
          )}
          {pathSegments.map((s) => (
            <SlopeSegment key={s.key} a={s.a} b={s.b} width={s.width} color={shade(T.pathColor)} outline={outline} />
          ))}
        </>
      )}

      {T.showLabels &&
        measuredPaths.map((t) => {
          const middle = t.points[Math.floor(t.points.length / 2)];
          const y = t.startElevation + t.rise * 0.5;
          const isOff = Math.abs(t.planarLength - t.plannedLength) > 0.6;
          return (
            <Label key={t.code} position={planPoint(middle[0], middle[1], y + 2)} color={isOff ? "#FFC9C2" : "#F6E7B8"}>
              {t.code} {t.name} · {t.route} · w{t.width} · {t.planarLength.toFixed(1)} m · {t.slope.toFixed(1)}°
            </Label>
          );
        })}

      {/* 연결로 — 그림과 걷는 높이가 같은 함수를 본다 */}
      {ramp?.geometry && (
        <mesh name={MESH_NAMES.connectorRamp} geometry={ramp.geometry} receiveShadow castShadow>
          <GroundMaterial
            shading={shading}
            brightness={T.brightness}
            doubleSided
            grain
            grainEnabled={T.groundGrain > 0}
          />
        </mesh>
      )}

      {/* 높이 있는 구역의 옆구리 — 절벽·차단물과 같은 바위 */}
      {blockerShapes?.zoneRocks.map((z) => (
        <mesh name={MESH_NAMES.zoneSides} key={`zoneRock-${z.code}`} geometry={z.geometry} receiveShadow castShadow>
          <GroundMaterial
            shading={shading}
            brightness={T.brightness}
            doubleSided
            grain
            grainEnabled={T.groundGrain > 0}
          />
        </mesh>
      ))}

      {/* 시야 차단물 — 끄면 회색 상자 */}
      {blockerShapes
        ? blockerShapes.pieces.map((b) => {
            // 판정은 무너짐이 끝나는 순간에만 열리므로 「보이는데 못 지나감」이 안 생긴다.
            const isCleared = clearedBlockers.has(b.code);
            const progress = collapse?.code === b.code ? collapse.progress : isCleared ? 1 : 0;
            if (isCleared && progress >= 1) return null;
            const v = collapseTransform(progress, b.actualHeight ?? 4);
            return (
              <group
                key={`blocker-${b.code}`}
                position={[0, v.sink, 0]}
                scale={[1, v.squash, 1]}
                rotation={[v.tilt, 0, v.tilt * 0.4]}
              >
                <mesh name={MESH_NAMES.blockerRock} geometry={b.rock} receiveShadow castShadow>
                  <GroundMaterial shading={shading} brightness={T.brightness} doubleSided />
                </mesh>
                {T.showLabels && (
                  <Label position={planPoint(b.center[0], b.center[1], b.top + 1.2)} color="#CBD3E0" size={11}>
                    {b.code} {b.name} · {b.role}
                  </Label>
                )}
              </group>
            );
          })
        : blockers.map((b) => {
            const w = b.x[1] - b.x[0];
            const d = b.z[1] - b.z[0];
            const cx = (b.x[0] + b.x[1]) / 2;
            const cz = (b.z[0] + b.z[1]) / 2;
            const foot = b.foot ?? 0;
            const floor = b.floor ?? 0;
            return (
              <group key={b.code}>
                {floor > foot && (
                  <mesh position={planPoint(cx, cz, (foot + floor) / 2)} castShadow receiveShadow>
                    <boxGeometry args={[w * U, (floor - foot) * U, d * U]} />
                    <meshToonMaterial color={shade(T.cliffColor)} gradientMap={TOON_GRADIENT} />
                    {outline}
                  </mesh>
                )}
                <mesh position={planPoint(cx, cz, floor + b.height / 2)} castShadow receiveShadow>
                  <boxGeometry args={[w * U, b.height * U, d * U]} />
                  <meshToonMaterial color={shade(T.blockerColor)} gradientMap={TOON_GRADIENT} />
                  {outline}
                </mesh>
              </group>
            );
          })}

      {/* 시점 V1~V3 (개발용 표식) — 시작 자리가 V1 이라 게임 화면에서는 캐릭터를 관통한다. ?dev 일 때만 */}
      {SHOW_DEV_TOOLS &&
        VIEWPOINTS.map((v) => {
          const sample = terrain.groundAt(v.x, v.z);
          return (
            <group key={v.code} position={planPoint(v.x, v.z, sample.y)}>
              <mesh position={[0, T.eyeHeight * U * 0.5, 0]}>
                <cylinderGeometry args={[0.05 * U, 0.05 * U, T.eyeHeight * U, 6]} />
                <meshBasicMaterial color={v.color} toneMapped={false} />
              </mesh>
              {T.showLabels && (
                <Label position={[0, T.eyeHeight * U + 1.2 * U, 0]} color={v.color}>
                  {v.code} · {v.zone} · {v.heading} · 키 {v.code[1]} · 볼 것: {v.shows}
                </Label>
              )}
            </group>
          );
        })}

      {/* 조사점 후보 슬롯 — 구슬이 크면 공간보다 표식이 먼저 보여 낮은 고리 + 가는 핀으로 줄였다 */}
      {T.showInvestigationPoints &&
        INVESTIGATION_POINTS.map((s) =>
          s.points.map(([x, z], i) => {
            const sample = terrain.groundAt(x, z);
            return (
              <group key={`${s.scene}-${i}`} position={planPoint(x, z, sample.y)}>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04 * U, 0]}>
                  <ringGeometry args={[0.32 * U, 0.46 * U, 20]} />
                  <meshBasicMaterial
                    color={s.color}
                    toneMapped={false}
                    side={THREE.DoubleSide}
                    transparent
                    opacity={0.85}
                  />
                </mesh>
                <mesh position={[0, 0.5 * U, 0]}>
                  <cylinderGeometry args={[0.035 * U, 0.035 * U, 1 * U, 6]} />
                  <meshBasicMaterial color={s.color} toneMapped={false} />
                </mesh>
                {/* 구슬마다 붙이면 글자밭이 된다 — 씬당 하나만 */}
                {T.showLabels && i === 0 && (
                  <Label position={[0, 1.3 * U, 0]} color={s.color} size={10.5}>
                    S{s.scene} {SCENE_TITLES[s.scene]}
                  </Label>
                )}
              </group>
            );
          }),
        )}
      {T.showInvestigationPoints && (
        <group>
          {/* 아비사 본체는 인스턴스 무리(씬1.아비사)다. 구운 모형이 오기 전에만 옛 코드 사람이 선다. */}
          {!bakedAbisa.geometry && (
            <mesh name={MESH_NAMES.peopleNpc} geometry={people.npc ?? undefined} castShadow receiveShadow>
              <GroundMaterial shading={shading} brightness={T.brightness} />
            </mesh>
          )}
          {T.showLabels && (
            <Label position={planPoint(NPC.x, NPC.z, terrain.groundAt(NPC.x, NPC.z).y + 2.1)} color="#FFC4BC">
              {NPC.name} ({NPC.zone}) · §163 대화
            </Label>
          )}
        </group>
      )}

      <SceneNoteLabel sceneNumber={1} enabled={T.showLabels && T.scene1Props} spots={scene1} notes={SCENE1_NOTES} />
      <SceneNoteLabel sceneNumber={2} enabled={T.showLabels && T.scene2Props} spots={scene2} notes={SCENE2_NOTES} />
      <SceneNoteLabel
        sceneNumber={3}
        enabled={T.showLabels && T.scene3Props}
        spots={scene3}
        notes={SCENE3_NOTES}
        isFlat
      />
      <SceneNoteLabel
        sceneNumber={4}
        enabled={T.showLabels && T.scene4Props}
        spots={scene4}
        notes={SCENE4_NOTES}
        isFlat
      />
      <SceneNoteLabel sceneNumber={5} enabled={T.showLabels && T.scene5Props} spots={scene5} notes={SCENE5_NOTES} />

      {/* 사람 자 — 절벽 위에서 아래 사람이 사람으로 보이는지(§3) */}
      {T.showHumanScale && people.scaleFigures && (
        <mesh name={MESH_NAMES.peopleScaleFigure} geometry={people.scaleFigures} castShadow receiveShadow>
          <GroundMaterial shading={shading} brightness={T.brightness} />
        </mesh>
      )}

      {/* 왜곡 잔상 — 거리로 뿌옇게 하면 그건 안개다. 그 마을만 이상해야 해서 택촌에만 건다. */}
      {distortion.strength > 0 &&
        instanceGroups
          .filter((group) => group.groupId === GROUP_IDS.taekchonHouses)
          .map((group) => (
            <AfterimageGroup
              key={`afterimage-${group.groupId}`}
              group={group}
              kind={distortion.kind}
              strength={distortion.strength}
              horizonColor={SKY_STYLE.horizon}
            />
          ))}

      {instanceGroups.map((group) => (
        <InstanceGroupMesh
          key={group.groupId}
          group={group}
          outline={outline}
          shading={shading}
          brightness={T.brightness}
          outlineVegetation={T.vegetationOutline}
        />
      ))}

      {/* 단면선 A–A′ · B–B′ — 가늘고 반투명하게, 필요할 때만 눈에 들게 */}
      {T.showSections &&
        SECTIONS.map((c) => {
          const isAlongX = c.axis === "Z";
          return (
            <mesh
              key={c.code}
              position={isAlongX ? planPoint(coreWidth / 2, c.value, 0.06) : planPoint(c.value, coreDepth / 2, 0.06)}
            >
              <boxGeometry args={[(isAlongX ? coreWidth : 0.1) * U, 0.04 * U, (isAlongX ? 0.1 : coreDepth) * U]} />
              <meshBasicMaterial color="#C0555F" toneMapped={false} transparent opacity={0.45} depthWrite={false} />
            </mesh>
          );
        })}

      {T.showGrid && gridGeometry && (
        <lineSegments geometry={gridGeometry} frustumCulled={false}>
          <lineBasicMaterial color="#6B7788" toneMapped={false} transparent opacity={0.55} />
        </lineSegments>
      )}

      <Editor
        enabled={isEditing}
        edits={edits}
        setEdits={setEdits}
        groundHeightAt={(x: number, z: number) => ground.surface.heightAt(x, z)}
        unlockPointer={() => controlsRef.current?.unlock?.()}
        overview={isOverview}
        setOverview={setIsOverview}
      />

      {/* 게임 공간 전체를 캐릭터와 같은 cel 질감으로(같은 그라디언트라 계단이 맞는다). ?worldtoon=off 로 비교. */}
      {toonConfig?.enabled && toonConfig.world !== false && (
        <WorldToon enabled steps={toonConfig.steps} threshold={toonConfig.threshold} />
      )}

      {/* 제 Suspense 를 반드시 씌운다 — 안 씌우면 캐릭터 GLB 를 읽는 동안 씬 전체가 내려갔다 올라온다. */}
      <Suspense fallback={null}>
        {isAvatarMounted &&
          (meshConfig ? (
            <ChibiGameAvatar
              visible={isThirdPerson}
              playerRef={playerState}
              config={meshConfig}
              body="meshy"
              toon={toonConfig ?? undefined}
              outline={outlineConfig ?? undefined}
            />
          ) : (
            <SidekickGameAvatar visible={isThirdPerson} playerRef={playerState} config={sidekickConfig} />
          ))}
      </Suspense>

      <PointerLockControls
        ref={controlsRef}
        selector="#no-such-element"
        onLock={() => onLockChange(true)}
        onUnlock={() => onLockChange(false)}
      />
    </>
  );
}

// V2 앞의 창 — §4 가 「사건 이해를 위해 의도적으로 열어 둔 유일한 시선」이라 못박았는데 절벽 머리 덤불이
// V2 에서 Z2 를 0 % 로 막았다. 네모로 도려내면 실루엣에 자로 그은 홈이 생기므로 한복판은 비우고 가장자리는 키를 서서히 되돌린다.
const WINDOW_HALF_WIDTH = 3.5; // m — V2 에서 Z2 로 가는 광선다발이 마루를 넘는 폭
const WINDOW_FADE = 3.0; // m — 키가 0 에서 제 키로 돌아오는 구간

function cliffTopTreeSpots(
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
