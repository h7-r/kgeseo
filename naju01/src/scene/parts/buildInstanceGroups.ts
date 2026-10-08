import * as THREE from "three";

import type { TexturedModel as LoadedModel } from "../../loaders/useTexturedModels";
import { PEBBLE_START_INDEX } from "../../models/nature";
import { ASSET_CATALOG, assetPrototype } from "../../placement/assetCatalog";
import { GROUP_IDS } from "../../placement/editFile";
import {
  applyEdits,
  createInstanceGroup,
  jitterStones,
  type Edits,
  type InstanceGroup,
  type InstanceGroupOptions,
  type ScatterSpot,
  type Spot,
} from "../../placement/instanceGroups";
import { NPC } from "../../plan/sitePlan";
import type { scene1Spots } from "../../story/scene1";
import type { scene2Spots } from "../../story/scene2";
import type { scene3Spots } from "../../story/scene3";
import type { scene4Spots } from "../../story/scene4";
import type { scene5Spots } from "../../story/scene5";
import { CLIFF_STYLE, EARTH_WALL_STYLE } from "../../terrain/cliff";
import { PATH_STYLE } from "../../terrain/slopePaths";
import { villageFenceSpots } from "../../world/villageFences";

type Shapes = THREE.BufferGeometry[];
type GroundHeight = (x: number, z: number) => number;

/** 표본 묶음 — 지름 1 · 밑동 원점. 자리·크기·회전은 인스턴스가 갖는다. */
export interface NajuPrototypes {
  trees: Shapes;
  shrubs: Shapes;
  leafPiles: Shapes;
  stones: Shapes;
  rocks: Shapes;
  pebbles: Shapes;
  posts: Shapes;
  rails: Shapes;
  distantTrees: Shapes;
  distantHouses: Shapes;
  weeds: Shapes;
  flowers: Shapes;
  landings: Shapes;
  steppingStones: Shapes;
  netFrames: Shapes;
  fishTraps: Shapes;
  tents: Shapes;
  cairns: Shapes;
  bonfires: Shapes;
  serpents: Shapes;
  platformBeds: Shapes;
  stools: Shapes;
  aFrameCarriers: Shapes;
  waterJars: Shapes;
  birdPoles: Shapes;
  strawShoes: Shapes;
  hairRibbons: Shapes;
  dirtClods: Shapes;
  brokenBranches: Shapes;
  boatMarks: Shapes;
  stakes: Shapes;
  footprints: Shapes;
  sacredRopes: Shapes;
  smallTables: Shapes;
  stonePiles: Shapes;
}

type TexturedModel = Pick<LoadedModel, "prototypes" | "material">;

interface InstanceGroupInputs {
  edits: Edits;
  prototypes: NajuPrototypes;
  bakedNature: boolean;
  groundAt: (x: number, z: number) => { y: number };
  treeBeltSpots: Spot[] | null;
  hill: { treeSpots: Spot[]; shrubSpots: Spot[] } | null;
  roadside: { trees: Spot[]; shrubs: Spot[]; leafPiles: Spot[] } | null;
  paths: {
    stoneSpots: ScatterSpot[];
    slopeRockSpots: ScatterSpot[];
    crevasseRockSpots: ScatterSpot[];
    slopeShrubSpots: Spot[];
  } | null;
  footScreeSpots: ScatterSpot[] | null;
  fences: { posts: Spot[]; rails: Spot[] } | null;
  distant: {
    fieldHeight: GroundHeight;
    forestVillages: { treeSpots: Spot[]; houseSpots: Spot[]; taekchonSpots: Spot[] };
  } | null;
  farLandingSpots: Spot[];
  steppingStones: { stones: Spot[] } | null;
  scene1: ReturnType<typeof scene1Spots> | null;
  scene2: ReturnType<typeof scene2Spots> | null;
  scene3: ReturnType<typeof scene3Spots> | null;
  scene4: ReturnType<typeof scene4Spots> | null;
  scene5: ReturnType<typeof scene5Spots> | null;
  serpent: TexturedModel;
  abisa: TexturedModel;
  fisher: TexturedModel;
  fisher2: TexturedModel;
  fisher3: TexturedModel;
  pebbleSpots: (ScatterSpot & { color?: number | string })[];
  cliff: { boulderSpots: ScatterSpot[]; crevasseShrubSpots: Spot[]; topTreeSpots: Spot[] } | null;
  ferryBoat: { spot: Spot; shape: THREE.BufferGeometry } | null;
}

// 모형 덤불은 한 포기가 아니라 한 뙈기다(가로가 키의 1.8 배). 모양은 누르지 않고 키로만 맞춘다 —
// 가로로 누르면 「선인장 같다」는 기둥이 된다.
const scaled = (spots: Spot[], factor: number): Spot[] => spots.map((a) => ({ ...a, size: (a.size ?? 1) * factor }));

// 1 m 를 넘으면 근경 바위, 아니면 자갈돌 — 무리째가 아니라 돌 하나하나를 가른다(틈바위는 크기가 섞여 있다).
const BIG_STONE_SIZE = 1.0;
// 자갈은 0.45 m 를 넘는 것만 바위로 바꾼다. 무리를 쪼개면 edits.json 손 배치가 갈 곳을 잃는다.
const BIG_PEBBLE_SIZE = 0.45;
// 앞 일곱 = 근경 바위(9,000 삼각형), 뒤 일곱 = 자갈돌(90)
const pickStoneShape = (size: number | undefined, id: number) =>
  (size ?? 1) > BIG_STONE_SIZE ? id % PEBBLE_START_INDEX : PEBBLE_START_INDEX + (id % PEBBLE_START_INDEX);

// 텍스처 모형은 색을 곱하면 물든다 — 흰색으로 둔다.
const TEXTURE_WHITE = "#ffffff";

/** 돌마다 어둠→밝음 사이를 0.32~0.94 로 섞는다. 다 같은 회색이면 자갈밭이 시멘트 판으로 보인다. */
function stoneShade(light: THREE.ColorRepresentation, dark: THREE.ColorRepresentation) {
  const lightColor = new THREE.Color(light);
  const darkColor = new THREE.Color(dark);
  const color = new THREE.Color();
  return (t: number) =>
    color
      .copy(darkColor)
      .lerp(lightColor, 0.32 + t * 0.62)
      .getHex();
}

/**
 * 자리 목록 + 편집 → 인스턴스 무리. 무리 id 가 곧 edits.json 열쇠이고
 * 담는 순서·난수 소비가 바뀌면 손 배치가 엉뚱한 물건에 붙는다 — 순서를 그대로 둔다.
 */
export function buildInstanceGroups(input: InstanceGroupInputs): InstanceGroup[] {
  const { edits, prototypes: shapes, groundAt } = input;
  const groups: InstanceGroup[] = [];
  const builtIds = new Set<string>();
  const add = (
    groupId: string,
    spots: Spot[],
    groupShapes: Shapes,
    options: Omit<InstanceGroupOptions, "groupId" | "shapes" | "spots" | "edits"> = {},
  ) => {
    const group = createInstanceGroup({ groupId, shapes: groupShapes, spots, edits, ...options });
    if (group) {
      groups.push(group);
      builtIds.add(groupId);
    }
  };

  if (input.treeBeltSpots?.length)
    add(GROUP_IDS.treeBeltTrees, input.treeBeltSpots, shapes.trees, { doubleSided: true });

  const { hill } = input;
  if (hill) {
    // 잎이 한 겹짜리 판이라 양면이 아니면 뒷면 쪽에 구멍이 뚫린 것처럼 보인다.
    add(GROUP_IDS.hillTrees, hill.treeSpots, shapes.trees, { doubleSided: true });
    // 덤불 자리를 덤불 : 잡초 : 꽃 = 8 : 3 : 1 로 나눠 쓴다 — 꽃은 드물어야 눈에 띈다.
    add(
      GROUP_IDS.hillShrubs,
      scaled(
        hill.shrubSpots.filter((_, i) => i % 12 < 3),
        0.6,
      ),
      shapes.shrubs,
      { doubleSided: true },
    );
    add(
      GROUP_IDS.hillWeeds,
      scaled(
        hill.shrubSpots.filter((_, i) => i % 12 >= 3 && i % 12 < 5),
        0.45,
      ),
      shapes.weeds,
      { doubleSided: true },
    );
    add(
      GROUP_IDS.hillFlowers,
      scaled(
        hill.shrubSpots.filter((_, i) => i % 12 === 5),
        0.4,
      ),
      shapes.flowers,
      { doubleSided: true },
    );
  }

  const { roadside } = input;
  if (roadside) {
    add(GROUP_IDS.roadsideTrees, roadside.trees, shapes.trees, { doubleSided: true });
    add(
      GROUP_IDS.roadsideShrubs,
      scaled(
        roadside.shrubs.filter((_, i) => i % 3 === 0),
        0.6,
      ),
      shapes.shrubs,
      { doubleSided: true },
    );
    add(
      GROUP_IDS.roadsideWeeds,
      scaled(
        roadside.shrubs.filter((_, i) => i % 3 === 1),
        0.45,
      ),
      shapes.weeds,
      { doubleSided: true },
    );
    // 잎더미 무리에도 모형 덤불을 넣는다. 무리 id 는 손 배치 때문에 그대로 둔다.
    add(GROUP_IDS.roadsideLeafPiles, scaled(roadside.leafPiles, 0.6), shapes.shrubs, { doubleSided: true });
  }

  // 모형자연을 끄면 표본이 절차적 돌 여섯 종이라 「앞 일곱 / 뒤 일곱」 가름이 없다.
  const hasTwoStoneKinds = (shapes.pebbles?.length ?? 0) > PEBBLE_START_INDEX;
  // 색을 꼭 넘긴다 — 빼먹으면 돌이 통째로 검게 나온다.
  const addStones = (
    groupId: string,
    spots: ScatterSpot[] | undefined,
    seed: number,
    flatten?: [number, number],
    shade = stoneShade(CLIFF_STYLE.bright, CLIFF_STYLE.dark),
  ) => {
    if (!spots?.length) return;
    add(groupId, jitterStones(spots, seed, { flatten, color: shade }), shapes.pebbles, {
      // 편집을 얹은 뒤의 키로 골라야 하므로 함수로 넘긴다
      shapeForSize: hasTwoStoneKinds ? pickStoneShape : null,
    });
  };

  const { paths } = input;
  if (paths) {
    addStones(
      GROUP_IDS.roadsideStones,
      paths.stoneSpots,
      90211,
      undefined,
      stoneShade(PATH_STYLE.stone, PATH_STYLE.stoneDark),
    );
    addStones(
      GROUP_IDS.slopeRocks,
      paths.slopeRockSpots,
      611303,
      undefined,
      stoneShade(CLIFF_STYLE.bright, EARTH_WALL_STYLE.dark),
    );
    addStones(GROUP_IDS.crevasseRocks, paths.crevasseRockSpots, 224401, [0.85, 1.5]);
    if (paths.slopeShrubSpots?.length)
      add(GROUP_IDS.slopeShrubs, scaled(paths.slopeShrubSpots, 0.6), shapes.shrubs, { doubleSided: true });
  }
  if (input.footScreeSpots) addStones(GROUP_IDS.footScree, input.footScreeSpots, 505017);

  // 기둥과 가로대를 따로 담는다 — 가로대는 길이가 제각각이라 같은 표본을 못 쓴다.
  if (input.fences) {
    add(GROUP_IDS.fencePosts, input.fences.posts, shapes.posts);
    add(GROUP_IDS.fenceRails, input.fences.rails, shapes.rails);
  }

  const { distant } = input;
  if (distant?.forestVillages) {
    const villages = distant.forestVillages;
    add(GROUP_IDS.distantTrees, villages.treeSpots, shapes.distantTrees);
    add(GROUP_IDS.distantHouses, villages.houseSpots, shapes.distantHouses);
    // 택촌은 따로 담아 왜곡 연출을 이 무리에만 건다.
    add(GROUP_IDS.taekchonHouses, villages.taekchonSpots, shapes.distantHouses);
    // 마당 울은 편집을 얹은 뒤의 집 자리로 세운다 — 생성기 자리를 쓰면 사람이 옮긴 집을 못 따라간다.
    const villageFences: [string, string, Spot[], number][] = [
      [GROUP_IDS.villageFence, GROUP_IDS.distantHouses, villages.houseSpots, 7731],
      [GROUP_IDS.taekchonFence, GROUP_IDS.taekchonHouses, villages.taekchonSpots, 8817],
    ];
    for (const [fenceId, houseId, houseSpots, seed] of villageFences) {
      const houses = applyEdits(houseId, houseSpots, edits);
      if (!houses.length) continue;
      // 집마다 앉은 높이가 제각각이라 집 y 로 세우면 울이 땅에 묻힌다 — 들판 높이 함수를 넘긴다.
      const fence = villageFenceSpots({ houseSpots: houses, groundHeight: distant.fieldHeight ?? null, seed });
      add(`${fenceId}.기둥`, fence.posts, shapes.posts);
      add(`${fenceId}.가로대`, fence.rails, shapes.rails);
    }
  }
  if (input.farLandingSpots.length) add(GROUP_IDS.distantLanding, input.farLandingSpots, shapes.landings);
  if (input.steppingStones) add(GROUP_IDS.steppingStones, input.steppingStones.stones, shapes.steppingStones);

  const { scene1 } = input;
  if (scene1) {
    add(GROUP_IDS.scene1NetFrames, scene1.netFrame, shapes.netFrames, { doubleSided: true });
    add(GROUP_IDS.scene1FishTraps, scene1.fishTrap, shapes.fishTraps, { doubleSided: true });
    add(GROUP_IDS.scene1Tents, scene1.tent, shapes.tents, { doubleSided: true });
    add(GROUP_IDS.scene1Cairns, scene1.cairn, shapes.cairns);
    add(GROUP_IDS.scene1Bonfires, scene1.bonfire, shapes.bonfires, { doubleSided: true });
    // 구운 모형이 오기 전에 깎은 표본으로 세우면 흰 구렁이가 한 번 번쩍 뜬다 — 늦게 나타나는 편이 낫다.
    if (!input.bakedNature || input.serpent.prototypes) add(GROUP_IDS.scene1Serpent, scene1.serpent, shapes.serpents);
    // 하나뿐인 사람도 무리로 넣어야 편집기로 집어 자리·방향을 잡는다. 도착 전에는 담을 것이 없다.
    if (input.abisa.prototypes)
      add(
        GROUP_IDS.scene1Abisa,
        [
          {
            id: 0,
            x: NPC.x,
            z: NPC.z,
            y: groundAt(NPC.x, NPC.z).y,
            size: 1.62, // 실제 키(m) — 표본이 높이 규약이라 그대로 배율이다
            rotation: Math.PI * 0.15,
            color: TEXTURE_WHITE,
          },
        ],
        input.abisa.prototypes,
        { material: input.abisa.material },
      );
  }
  // 어부 셋은 사람 키를 재는 자도 겸한다. 서 있는 데가 Z1 밖이라 `씬1.` 을 안 붙인다.
  const people: [string, TexturedModel, number, number, number, number][] = [
    [GROUP_IDS.fisher, input.fisher, 50, 38, 1.8, -1.2],
    [GROUP_IDS.fisher2, input.fisher2, 40, 36, 1.72, 0.4],
    [GROUP_IDS.fisher3, input.fisher3, 45, 33, 1.58, 2.1],
  ];
  for (const [groupId, model, x, z, size, rotation] of people) {
    if (!model.prototypes) continue;
    add(groupId, [{ id: 0, x, z, y: groundAt(x, z).y, size, rotation, color: TEXTURE_WHITE }], model.prototypes, {
      material: model.material,
    });
  }

  const { scene2 } = input;
  if (scene2) {
    add(GROUP_IDS.scene2PlatformBeds, scene2.platformBed, shapes.platformBeds);
    add(GROUP_IDS.scene2Stools, scene2.stool, shapes.stools);
    add(GROUP_IDS.scene2AFrameCarriers, scene2.aFrameCarrier, shapes.aFrameCarriers, { doubleSided: true });
    add(GROUP_IDS.scene2WaterJars, scene2.waterJar, shapes.waterJars);
    add(GROUP_IDS.scene2BirdPoles, scene2.birdPole, shapes.birdPoles);
  }
  const { scene3 } = input;
  if (scene3) {
    add(GROUP_IDS.scene3StrawShoes, scene3.strawShoe, shapes.strawShoes, { doubleSided: true });
    add(GROUP_IDS.scene3HairRibbons, scene3.hairRibbon, shapes.hairRibbons, { doubleSided: true });
    add(GROUP_IDS.scene3DirtClods, scene3.dirtClod, shapes.dirtClods);
    add(GROUP_IDS.scene3BrokenBranches, scene3.brokenBranch, shapes.brokenBranches, { doubleSided: true });
  }
  const { scene4 } = input;
  if (scene4) {
    add(GROUP_IDS.scene4BoatMarks, scene4.boatMark, shapes.boatMarks);
    add(GROUP_IDS.scene4Stakes, scene4.stake, shapes.stakes, { doubleSided: true });
    add(GROUP_IDS.scene4Footprints, scene4.footprint, shapes.footprints);
  }
  const { scene5 } = input;
  if (scene5) {
    add(GROUP_IDS.scene5StonePiles, scene5.stonePile, shapes.stonePiles);
    add(GROUP_IDS.scene5SacredRopes, scene5.sacredRope, shapes.sacredRopes, { doubleSided: true });
    add(GROUP_IDS.scene5SmallTables, scene5.smallTable, shapes.smallTables);
  }

  if (input.pebbleSpots?.length) {
    // 큰 것은 근경 바위 모양에 바위빛, 작은 것은 자갈돌 그대로. 손으로 놓은 것은 모양 0~6 이라 저절로 바위가 된다.
    add(
      GROUP_IDS.pebbles,
      input.pebbleSpots.map((a, i) => {
        const isBig = (a.size ?? 0) > BIG_PEBBLE_SIZE;
        return {
          ...a,
          size: a.size ?? 0,
          shapeIndex: isBig ? i % PEBBLE_START_INDEX : PEBBLE_START_INDEX + (i % PEBBLE_START_INDEX),
          color: isBig ? CLIFF_STYLE.bright : a.color,
          rotation: ((i * 2654435761) % 1000) / 159.15,
          tilt: (((i * 40503) % 1000) / 1000 - 0.5) * 0.7,
        };
      }),
      shapes.pebbles,
    );
  }

  const { cliff } = input;
  if (cliff) {
    addStones(GROUP_IDS.boulders, cliff.boulderSpots, 480913, [0.62, 1.0]);
    if (cliff.crevasseShrubSpots?.length)
      add(GROUP_IDS.cliffCrevasseShrubs, scaled(cliff.crevasseShrubSpots, 0.6), shapes.shrubs, { doubleSided: true });
    if (cliff.topTreeSpots?.length)
      add(GROUP_IDS.cliffTopShrubs, scaled(cliff.topTreeSpots, 0.6), shapes.shrubs, { doubleSided: true });
  }

  // 널배라 안쪽 바닥이 보인다 — 양면이어야 뚫리지 않는다.
  if (input.ferryBoat) add(GROUP_IDS.ferryBoat, [input.ferryBoat.spot], [input.ferryBoat.shape], { doubleSided: true });

  // 팔레트로 놓은 것은 생성 자리가 없고 편집의 「더함」이 곧 자리 목록이다.
  for (const asset of ASSET_CATALOG) {
    const placed = edits?.added?.[asset.key];
    if (!placed?.length) continue;
    // 「원경.나무」처럼 생성 무리와 같은 id 면 거기에 이미 섞였다 — 또 세우면 두 번 그려진다.
    if (builtIds.has(asset.key)) continue;
    add(asset.key, [], assetPrototype(asset.key) ?? [], { doubleSided: !!asset.doubleSided });
  }
  return groups;
}
