// NAJU-01 A-01 도면을 그대로 세운 그레이박스. 상자와 치수로 공간을 세우고 1인칭으로 걸어 보며
// 넓이·높이·경사·동선·시야(V1~V3)가 도면과 맞는지 먼저 확인한다 — 꾸미기는 그 뒤다.
// 훅 순서가 곧 생성·효과·프레임 등록 순서다 — 손 배치(edits.json)가 생성 순서에 걸려 있으니 순서를 바꾸지 않는다.
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { Outlines, PointerLockControls } from "@react-three/drei";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import type { AvatarLink } from "@/engine/avatarLink";
import { scaleColor } from "@/engine/color";
import { pickOutlineValues } from "@/engine/leva/savedControls";
import { TOON_GRADIENT } from "@/engine/toon";

import { usePresentationOverrides } from "../app/presentation";
import type { MeshAppearanceConfig } from "../avatar/meshAppearance";
import type { SidekickConfig } from "../avatar/sidekickOptions";
import type { ToonConfig } from "../avatar/toonMaterial";
import type { OutlineConfig } from "../avatar/toonOutline";
import Editor from "../placement/Editor";
import { GROUP_IDS } from "../placement/editFile";
import { MESH_NAMES } from "../plan/meshNames";
import { CORE, UNITS_PER_METER } from "../plan/sitePlan";
import { SKY_STYLE } from "../world/sky";
import WorldToon from "../world/WorldToon";
import { buildInstanceGroups } from "./buildInstanceGroups";
import AfterimageGroup from "./components/AfterimageGroup";
import BlockerLayer from "./components/BlockerLayer";
import DevMarkers from "./components/DevMarkers";
import DistantLandscapeLayer from "./components/DistantLandscapeLayer";
import GroundLayer from "./components/GroundLayer";
import GroundMaterial from "./components/GroundMaterial";
import InstanceGroupMesh from "./components/InstanceGroupMesh";
import PathLayer from "./components/PathLayer";
import PlanOverlays from "./components/PlanOverlays";
import { planPoint } from "./components/planPoint";
import PlayerAvatar from "./components/PlayerAvatar";
import SceneNotes from "./components/SceneNotes";
import SkyAndLighting from "./components/SkyAndLighting";
import WaterLayer from "./components/WaterLayer";
import { useBlockerCollapse } from "./useBlockerCollapse";
import { useBlockerShapes } from "./useBlockerShapes";
import { toGroundShading, useNajuControls } from "./useNajuControls";
import { useNajuDevHook, useViewpointKeys } from "./useNajuDevTools";
import { usePathFallback, usePathShapes, useRoadsideSpots } from "./usePathLayers";
import { usePlayerMovement } from "./usePlayerMovement";
import { useRendererSetup, useSceneFrame, type NajuSceneReport } from "./useSceneFrame";
import { useSceneModes } from "./useSceneModes";
import { usePrototypes, useStoryModels, useStoryProps } from "./useStoryProps";
import { useSunLight } from "./useSunLight";
import { useBakedTerrainTexture, useGroundAndCliff, useRockAsset, useTerrain } from "./useTerrainLayers";
import {
  useConnectorRamp,
  useDistantLandscapeAndSky,
  useFarLandingSpots,
  useFerry,
  useGrass,
  useGridGeometry,
  usePeople,
  useRiver,
  useWaterRipple,
} from "./useWorldLayers";

export type { NajuSceneReport } from "./useSceneFrame";

const U = UNITS_PER_METER;

/** 세계 툰 스위치(world)를 더 든 툰 설정 — world = 게임 공간 전체에도 cel 질감을 입힐지(?worldtoon=off 비교용) */
export type NajuToonConfig = ToonConfig & { world?: boolean };

interface NajuSceneProps {
  active: boolean;
  controlsRef: RefObject<PointerLockControlsImpl | null>;
  onLockChange: (locked: boolean) => void;
  reportRef: RefObject<NajuSceneReport | null>;
  isThirdPerson?: boolean;
  sidekickConfig?: SidekickConfig;
  meshConfig?: MeshAppearanceConfig | null;
  toonConfig?: NajuToonConfig | null;
  outlineConfig?: OutlineConfig | null;
}

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
  // ?present · ?mood 가 있으면 그 프리셋이 Leva 저장값을 덮는다
  const controls = usePresentationOverrides(useNajuControls());
  const shading = toGroundShading(controls.groundShading);
  const outlineValues = pickOutlineValues(controls);
  // screenspace 를 켜야 thickness 가 월드 단위가 된다.
  const outline = outlineValues.outline ? (
    <Outlines thickness={controls.outlineWorldWidth} color={outlineValues.outlineColor} screenspace />
  ) : null;
  const shade = (color: string) => scaleColor(color, controls.brightness);

  const { rippleHandle, rippleMaterialRef } = useWaterRipple();

  // 지형·땅·절벽·차단물
  const { terrain, bakedTerrain, isBakedTerrainOn } = useTerrain(controls);
  const { measuredPaths, blockers } = terrain;
  const storyModels = useStoryModels();
  const { ground, maxDip, cliffShapes } = useGroundAndCliff(controls, terrain, isBakedTerrainOn);
  const blockerShapes = useBlockerShapes(controls, terrain, ground);

  // 원경·하늘·풀·사람·나룻배·통로
  const { distantLandscape, skyGeometry, cloudGeometry, skyRef, cloudRef } = useDistantLandscapeAndSky(controls);
  const grass = useGrass(controls, terrain);
  const people = usePeople(controls, terrain);
  const { ferryShape, ferrySpot } = useFerry(controls, terrain);
  const pathShapes = usePathShapes(controls, terrain, ground);

  const { isEditing, isOverview, setIsOverview, isAvatarMounted, edits, setEdits } = useSceneModes({
    active,
    isThirdPerson,
    playerState,
  });

  const prototypes = usePrototypes(controls, storyModels.serpent);
  const story = useStoryProps(controls, ground);
  const farLandingSpots = useFarLandingSpots(distantLandscape);
  const gridGeometry = useGridGeometry();
  const ramp = useConnectorRamp(controls, terrain, ground, distantLandscape);
  const { fences, roadside, hill } = useRoadsideSpots(controls, terrain, ground);

  const instanceGroups = useMemo(
    () =>
      buildInstanceGroups({
        edits,
        prototypes,
        bakedNature: controls.bakedNature,
        groundAt: terrain.groundAt,
        treeBeltSpots: blockerShapes?.pieces?.find((b) => b.code === "수목대")?.treeSpots ?? null,
        hill,
        roadside,
        paths: pathShapes,
        footScreeSpots: blockerShapes?.footScreeSpots ?? null,
        fences,
        distantLandscape,
        farLandingSpots,
        steppingStones: story.steppingStones,
        scene1: story.scene1,
        scene2: story.scene2,
        scene3: story.scene3,
        scene4: story.scene4,
        scene5: story.scene5,
        serpent: storyModels.serpent,
        abisa: storyModels.abisa,
        fisher: storyModels.fisher,
        fisher2: storyModels.fisher2,
        fisher3: storyModels.fisher3,
        pebbleSpots: ground?.pebbleSpots ?? [],
        cliff: cliffShapes,
        ferryBoat: ferrySpot && ferryShape ? { spot: ferrySpot, shape: ferryShape } : null,
      }),
    [
      hill,
      roadside,
      pathShapes,
      blockerShapes,
      cliffShapes,
      ferrySpot,
      ferryShape,
      fences,
      distantLandscape,
      farLandingSpots,
      story.scene1,
      story.scene2,
      story.scene3,
      story.scene4,
      story.scene5,
      story.steppingStones,
      prototypes,
      edits,
      storyModels.serpent,
      storyModels.abisa,
      storyModels.fisher,
      storyModels.fisher2,
      storyModels.fisher3,
      controls.bakedNature,
      ground,
      terrain,
    ],
  );

  const river = useRiver(controls, terrain);

  const { camera, gl, scene } = useRendererSetup(controls.fov);
  const teleport = usePlayerMovement({
    controls,
    active,
    isEditing,
    isOverview,
    isThirdPerson,
    terrain,
    instanceGroups,
    ramp,
    reportRef,
    playerState,
  });
  const rockAsset = useRockAsset(controls);
  useBakedTerrainTexture(scene, controls.bakedTerrainTexture);

  const { clearedBlockers, collapseRef, collapseNoticeRef, collapse, setCollapse, endScene } = useBlockerCollapse(
    terrain,
    blockerShapes,
    ground,
  );
  useNajuDevHook({ camera, gl, scene, terrain, controls, teleport, endScene, clearedBlockers, collapseRef, ramp });

  // 반드시 useTerrainMovement(usePlayerMovement) 뒤에 등록돼야 한다 — 그 훅이 매 프레임 reportRef.current 를 갈아끼운다.
  useSceneFrame({
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
    waterShift: story.distortion.waterShift,
    rippleHandle,
    bakedTerrainStatus: bakedTerrain.status,
  });
  useViewpointKeys(teleport, endScene, collapseNoticeRef);

  const pathFallback = usePathFallback(measuredPaths);
  const { sunTarget, sunRef, sunPosition } = useSunLight(controls, camera);

  const coreWidth = CORE.x[1] - CORE.x[0];
  const coreDepth = CORE.z[1] - CORE.z[0];
  const { distortion } = story;

  return (
    <>
      <SkyAndLighting
        controls={controls}
        skyGeometry={skyGeometry}
        skyRef={skyRef}
        cloudGeometry={cloudGeometry}
        cloudRef={cloudRef}
        sunTarget={sunTarget}
        sunRef={sunRef}
        sunPosition={sunPosition}
      />
      <DistantLandscapeLayer distantLandscape={distantLandscape} shading={shading} brightness={controls.brightness} />

      {/* 땅 밑받침 — 두께 없는 땅 가장자리·틈으로 뒤가 비치지 않게 */}
      <mesh position={planPoint(coreWidth / 2, coreDepth / 2, -0.9 - maxDip)} receiveShadow>
        <boxGeometry args={[coreWidth * U, 1.2 * U, coreDepth * U]} />
        <meshToonMaterial color={shade("#2E323A")} gradientMap={TOON_GRADIENT} />
      </mesh>

      <WaterLayer
        controls={controls}
        river={river}
        shading={shading}
        shade={shade}
        rippleMaterialRef={rippleMaterialRef}
      />
      <GroundLayer
        controls={controls}
        terrain={terrain}
        ground={ground}
        bakedTerrain={bakedTerrain}
        isBakedTerrainOn={isBakedTerrainOn}
        grass={grass}
        cliffShapes={cliffShapes}
        rockAsset={rockAsset}
        shading={shading}
        shade={shade}
        outline={outline}
      />
      <PathLayer
        controls={controls}
        measuredPaths={measuredPaths}
        pathShapes={pathShapes}
        fallback={pathFallback}
        isBakedTerrainOn={isBakedTerrainOn}
        ramp={ramp}
        shading={shading}
        shade={shade}
        outline={outline}
      />
      <BlockerLayer
        controls={controls}
        blockers={blockers}
        blockerShapes={blockerShapes}
        clearedBlockers={clearedBlockers}
        collapse={collapse}
        shading={shading}
        shade={shade}
        outline={outline}
      />
      <DevMarkers
        controls={controls}
        terrain={terrain}
        people={people}
        hasBakedAbisa={!!storyModels.abisa.geometry}
        shading={shading}
      />
      <SceneNotes controls={controls} story={story} />

      {/* 사람 자 — 절벽 위에서 아래 사람이 사람으로 보이는지(§3) */}
      {controls.showHumanScale && people.scaleFigures && (
        <mesh name={MESH_NAMES.peopleScaleFigure} geometry={people.scaleFigures} castShadow receiveShadow>
          <GroundMaterial shading={shading} brightness={controls.brightness} />
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
          brightness={controls.brightness}
          outlineVegetation={controls.vegetationOutline}
        />
      ))}

      <PlanOverlays controls={controls} gridGeometry={gridGeometry} />

      <Editor
        enabled={isEditing}
        edits={edits}
        setEdits={setEdits}
        heightAt={(x: number, z: number) => ground.surface.heightAt(x, z)}
        unlockPointer={() => controlsRef.current?.unlock?.()}
        overview={isOverview}
        setOverview={setIsOverview}
      />

      {/* 게임 공간 전체를 캐릭터와 같은 cel 질감으로(같은 그라디언트라 계단이 맞는다). ?worldtoon=off 로 비교. */}
      {toonConfig?.enabled && toonConfig.world !== false && (
        <WorldToon enabled steps={toonConfig.steps} threshold={toonConfig.threshold} />
      )}

      <PlayerAvatar
        isMounted={isAvatarMounted}
        visible={isThirdPerson}
        playerRef={playerState}
        sidekickConfig={sidekickConfig}
        meshConfig={meshConfig}
        toonConfig={toonConfig}
        outlineConfig={outlineConfig}
      />

      <PointerLockControls
        ref={controlsRef}
        selector="#no-such-element"
        onLock={() => onLockChange(true)}
        onUnlock={() => onLockChange(false)}
      />
    </>
  );
}
