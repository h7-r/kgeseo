import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type * as THREE from "three";

import { IS_ZONE_CULLING_DISABLED } from "@/app/runtimeFlags";
import type { AvatarLink } from "@/engine/avatarLink";
import { pickOutlineValues } from "@/engine/leva/savedControls";
import { PLAYER_RADIUS } from "@/engine/movement/constants";
import { OutlineViewportSync } from "@/engine/outline";
import { requestShadowUpdates, ShaderWarmup, ShadowMapUpdater } from "@/engine/rendering";
import type { OutlineValues } from "@/engine/toon";
import { useLobbyState } from "@/lobby/interactions";
import { registerItemSize, registerSurface, unregisterSurface } from "@/lobby/placement";
import type { ChibiConfig, OutlineConfig, SidekickConfig, ToonConfig } from "@/naju";
import { useCoins } from "@/props/coinState";
import { useDrink } from "@/props/drinkState";
import { useNozzle } from "@/props/nozzleState";
import { useVendingMachine } from "@/props/vendingMachineState";
import { ColliderDebugView } from "@/station/layout/Colliders";
import { isBlockedWithin } from "@/station/layout/collision";
import {
  HEADQUARTERS_MAX_X,
  HEADQUARTERS_MAX_Z,
  HEADQUARTERS_MIN_X,
  HEADQUARTERS_MIN_Z,
} from "@/station/layout/dimensions";
import type { NearTarget } from "@/station/layout/passage";
import { enteredDoor, exitedTrain, trainDoors } from "@/station/layout/trainDoors";
import { usePlayer, type ReturnPose } from "@/station/layout/usePlayer";
import ZoneCulling from "@/station/layout/ZoneCulling";
import DispatchPath from "@/tutorial/DispatchPath";

import BackdropArea from "./areas/BackdropArea";
import CorridorArea from "./areas/CorridorArea";
import {
  useCorridorBrightness,
  useCorridorSync,
  useWallCabinetDoors,
  computeWallCabinetSpots,
} from "./areas/corridorHooks";
import HeldItemsLayer from "./areas/HeldItemsLayer";
import LobbyAvatar from "./areas/LobbyAvatar";
import type { PickupLooks } from "./areas/PickupItemModel";
import HeadquartersArea from "./areas/HeadquartersArea";
import TrainArea from "./areas/TrainArea";
import { usePickupItems } from "./areas/usePickupItems";
import { useHydrantControls, usePadlockControls, usePanelInteriorControls } from "./controls/corridorCabinetControls";
import { useCorridorControls } from "./controls/corridorControls";
import {
  useBoardControls,
  useCabinetControls,
  useChairControls,
  useCoatRackControls,
  useDeskCommonControls,
  useDeskControls,
} from "./controls/furnitureControls";
import {
  useComputerControls,
  useEvidenceControls,
  useKeyboardMouseControls,
  useLaptopControls,
  useMugControls,
} from "./controls/headquartersPropControls";
import { usePaperControls } from "./controls/paperControls";
import {
  useCeilingLightControls,
  useDeskLampControls,
  useFloorLampControls,
  useLightingControls,
  useStructureOutlineControls,
  useSurfaceControls,
} from "./controls/headquartersControls";
import {
  useDebugPrintControls,
  useInteractionControls,
  useSystemControls,
  useViewControls,
  type DebugPrintValues,
} from "./controls/systemControls";
import { usePlatformEndWallControls, useTrainControls } from "./controls/trainControls";
import { useCoinControls, useVendingControls } from "./controls/vendingControls";
import { useWorkLampPuzzleControls } from "./controls/workLampControls";

interface StationSceneProps {
  active: boolean;
  onNear: (target: NearTarget) => void;
  isThirdPerson?: boolean;
  playerRef?: RefObject<AvatarLink> | null;
  sidekickConfig?: SidekickConfig;
  chibiConfig?: ChibiConfig;
  toonConfig?: ToonConfig;
  outlineConfig?: OutlineConfig;
  /** 지금 보이는 씬인가. 기차에 타 있는 동안에도 이 컴포넌트는 살아 있다. */
  enabled?: boolean;
}

/**
 * 기차에서 막 내렸다면 탔던 문 앞(방 안쪽으로 두 걸음)에 다시 세운다. 카메라가 하나뿐이라 그냥 두면
 * 기차 안 좌표가 역 좌표로 읽혀 방 한가운데에 떨어진다. 역 씬은 기차에 탄 동안에도 살아 있어
 * 꺼짐 → 켜짐 때마다 「방금 내렸나」를 다시 본다(그래서 deps 가 [enabled]).
 */
function useReturnPose(enabled: boolean): ReturnPose | null {
  return useMemo(() => {
    if (!enabled) return null;
    if (!exitedTrain.active || !enteredDoor.position) return null;
    exitedTrain.active = false; // 한 번 쓰면 끈다
    const door = enteredDoor.position;
    return { start: [door.x - 2.6, undefined, door.z], facing: Math.PI / 2 };
  }, [enabled]);
}

/**
 * 역 — 수사본부실·비밀 복도·멈춰 선 기차. 씬을 버리지 않고 보임만 끈다(visible=false 가지는 three 가 통째로 건너뛴다).
 * Leva 훅은 부르는 순서가 곧 패널 순서라 아래 순서를 바꾸지 않는다.
 */
export default function StationScene({
  active,
  onNear,
  isThirdPerson = false,
  playerRef = null,
  sidekickConfig,
  chibiConfig,
  toonConfig,
  outlineConfig,
  enabled = true,
}: StationSceneProps) {
  // 로비 물건 상태(서랍·램프·의자·든 것). 겨냥은 구독하지 않는다 — 고개만 돌려도 방 전체가 다시 그려진다.
  const lobby = useLobbyState();
  // 자판기는 드물게 바뀌는 값만 구독한다(버튼 불빛 같은 매 프레임 값은 자판기가 useFrame 에서 직접 읽는다)
  const drinkMachine = useVendingMachine("drink");
  const coffeeMachine = useVendingMachine("coffee");
  useCoins();
  useDrink();
  const nozzleLocation = useNozzle();
  useEffect(() => {
    registerItemSize("coin", { halfX: 0.25, halfZ: 0.25, height: 0.08 });
  }, []);
  useEffect(() => {
    registerSurface("floor", {
      minX: HEADQUARTERS_MIN_X,
      maxX: HEADQUARTERS_MAX_X,
      minZ: HEADQUARTERS_MIN_Z,
      maxZ: HEADQUARTERS_MAX_Z,
      top: 0,
    });
    return () => unregisterSurface("floor");
  }, []);

  // Leva — 아래 순서가 패널 순서다
  const view = useViewControls();
  const returnPose = useReturnPose(enabled);
  usePlayer({
    active,
    onNear,
    eye: view.eyeHeight,
    crouchEye: view.crouchEyeHeight,
    returnPose,
    thirdPerson: isThirdPerson,
    playerRef,
    enabled,
  });
  const surface = useSurfaceControls();
  const lighting = useLightingControls();
  const deskLamps = useDeskLampControls();
  const cabinets = useCabinetControls();
  const evidence = useEvidenceControls();
  const coatRacks = useCoatRackControls();
  const floorLamp = useFloorLampControls();
  const deskCommon = useDeskCommonControls();
  const computers = useComputerControls();
  const keyboardMouse = useKeyboardMouseControls();
  const laptops = useLaptopControls();
  const chairs = useChairControls();
  const mugs = useMugControls();
  const boards = useBoardControls();
  const ceilingLight = useCeilingLightControls();
  const train = useTrainControls();
  const { collision, performance } = useSystemControls();
  const corridor = useCorridorControls();
  const hydrant = useHydrantControls();
  const padlock = usePadlockControls();

  // 씬이 다시 그려졌다 = Leva 를 만졌거나 상태가 바뀌었다. 그때부터 잠깐(자물쇠 열림 연출 2.5초까지) 그림자를
  // 매 프레임 다시 그린다 — 그래서 deps 없이 커밋마다 돈다.
  useEffect(() => {
    requestShadowUpdates(2.8);
  });

  const workLamp = useWorkLampPuzzleControls();
  const shading = useCorridorBrightness(corridor, workLamp);
  useCorridorSync(corridor);
  const { hydrantDoorId, isHydrantLocked } = useWallCabinetDoors(corridor, padlock.padlock.visible);
  const panelInterior = usePanelInteriorControls();
  const vending = useVendingControls();
  const coin = useCoinControls();
  const endWall = usePlatformEndWallControls();
  const structureOutline = useStructureOutlineControls();
  const papers = usePaperControls();
  const { showFirstPersonBody, placementPreview, highlight } = useInteractionControls();
  const desks = useDeskControls();

  // 출력 버튼은 처음 만들 때 값을 붙잡아 두므로 최신 값을 ref 로 건넨다
  const debugValues = useRef<DebugPrintValues | null>(null);
  useLayoutEffect(() => {
    debugValues.current = {
      view,
      lighting,
      deskCommon,
      computer: computers.common,
      monitors: computers.monitors,
      keyboard: keyboardMouse.keyboard,
      mouse: keyboardMouse.mouse,
      laptop: laptops.common,
      laptops: laptops.laptops,
      papers: papers.papers,
      desks,
    };
  });
  useDebugPrintControls(debugValues);

  const pickups = usePickupItems({
    lobby,
    mugs: mugs.mugs,
    laptops: laptops.laptops,
    papers: papers.papers,
    coatRacks,
    evidence,
    monitors: computers.monitors,
    keyboardMouse,
  });
  const pickupLooks = usePickupLooks(mugs.common, coatRacks.hatOutline, evidence.common, keyboardMouse, laptops.common);
  const looks = useMemo<PickupLooks>(
    () => ({ ...pickupLooks, paperBrightness: papers.color.brightness, paperOutline: papers.outline }),
    [pickupLooks, papers.color.brightness, papers.outline],
  );
  const coinOutline = useMemo<OutlineValues>(
    () => ({
      outline: true,
      outlineWidth: coin.outlineWidth,
      outlineColor: coin.outlineColor,
      // 동전은 주름선을 안 쓴다(각도·색은 꺼진 칸이라 쓰이지 않는다)
      crease: false,
      creaseAngle: 40,
      creaseColor: "#000000",
    }),
    [coin.outlineWidth, coin.outlineColor],
  );
  const secretDoor = useMemo(
    () => (corridor.visible ? { z: corridor.doorZ, width: corridor.doorWidth, height: corridor.doorHeight } : null),
    [corridor.visible, corridor.doorZ, corridor.doorWidth, corridor.doorHeight],
  );
  const hoseBrightness = shading.brightnessAt(computeWallCabinetSpots(corridor).hydrant.z) * corridor.wallBrightness;

  const headquartersRef = useRef<THREE.Group>(null);
  const corridorRef = useRef<THREE.Group>(null);
  const trainRef = useRef<THREE.Group>(null);
  const backdropRef = useRef<THREE.Group>(null);
  const dimming = deskLamps.common.globalLightScale;

  return (
    <>
      {/* 배경·안개는 group 바깥이어야 한다. attach 는 바로 위 부모에 꽂아서 group 안이면 Group.fog 가 되고
          렌더러는 scene.fog 만 읽는다. 이 컴포넌트는 <Canvas> 직계 자식이라 부모가 곧 씬이다. */}
      {enabled && <color attach="background" args={[train.backdrop.backgroundColor]} />}
      {enabled && <fog attach="fog" args={[lighting.fogColor, lighting.fogNear, lighting.fogFar]} />}

      <group visible={enabled}>
        {/* 전체는 어둑하고 차갑게 눌러 버려진 역의 음침함을 만든다 */}
        <ambientLight intensity={lighting.ambientIntensity * dimming} color={lighting.ambientColor} />
        <hemisphereLight args={["#9FB0C8", "#2A2E36", lighting.hemisphereIntensity * dimming]} />
        <directionalLight
          castShadow
          position={[-14, 30, -4]}
          intensity={lighting.sunIntensity * dimming}
          color={lighting.sunColor}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
          shadow-camera-far={90}
          shadow-bias={-0.0004}
          shadow-normalBias={0.09}
        />

        <group ref={backdropRef}>
          <BackdropArea backdrop={train.backdrop} surface={surface} />
        </group>

        <OutlineViewportSync />
        <ShaderWarmup enabled={performance.shaderWarmup} />
        <ShadowMapUpdater
          enabled={performance.saveShadows}
          urgentInterval={performance.shadowInterval}
          slowInterval={performance.shadowSafetyInterval}
        />

        <ColliderDebugView visible={collision.showBoxes} height={collision.boxHeight} />
        {/* 출동 화살표는 복도 그룹 밖 — 구역 컬링이 본부실에서 복도 그룹을 끈다 */}
        <DispatchPath
          findDoor={trainDoors.rightmost}
          isBlocked={isBlockedWithin}
          headquartersBounds={{
            minX: HEADQUARTERS_MIN_X + PLAYER_RADIUS,
            maxX: HEADQUARTERS_MAX_X - PLAYER_RADIUS,
            minZ: HEADQUARTERS_MIN_Z + PLAYER_RADIUS,
            maxZ: HEADQUARTERS_MAX_Z - PLAYER_RADIUS,
          }}
          opening={[HEADQUARTERS_MIN_X + 1.2, corridor.doorZ]}
        />
        {/* 기차에 탄 동안은 돌리지 않는다 — 역이 통째로 안 보이는데 매 프레임 잴 필요가 없다 */}
        <ZoneCulling
          headquarters={headquartersRef}
          corridor={corridorRef}
          train={trainRef}
          backdrop={backdropRef}
          enabled={performance.zoneCulling && !IS_ZONE_CULLING_DISABLED && enabled}
        />

        <group ref={corridorRef}>
          {corridor.visible && (
            <CorridorArea
              corridor={corridor}
              surface={surface}
              shading={shading}
              workLamp={workLamp}
              hydrant={hydrant}
              padlock={padlock}
              panelInterior={panelInterior}
              vending={vending}
              coin={coin}
              coinOutline={coinOutline}
              highlight={highlight}
              eyeHeight={view.eyeHeight}
              isCollisionEnabled={collision.enabled}
              drinkMachine={drinkMachine}
              coffeeMachine={coffeeMachine}
              hydrantDoorId={hydrantDoorId}
              isHydrantLocked={isHydrantLocked}
            />
          )}
        </group>

        <group ref={trainRef}>
          <TrainArea train={train} endWall={endWall} surface={surface} />
        </group>

        <group ref={headquartersRef}>
          <HeadquartersArea
            lobby={lobby}
            ceilingLight={ceilingLight}
            deskLamps={deskLamps}
            floorLamp={floorLamp}
            cabinets={cabinets}
            evidence={evidence}
            coatRacks={coatRacks}
            surface={surface}
            structureOutline={structureOutline}
            secretDoor={secretDoor}
            frontWallEndX={train.brokenWall.frontEndX}
            backWallEndX={train.brokenWall.backEndX}
            deskCommon={deskCommon}
            desks={desks}
            computers={computers}
            chairs={chairs}
            boards={boards}
            pickups={pickups}
            pickupLooks={looks}
            highlight={highlight}
            collision={collision}
          />
        </group>

        <HeldItemsLayer
          lobby={lobby}
          pickups={pickups}
          looks={looks}
          placementPreview={placementPreview}
          coin={coin}
          coinOutline={coinOutline}
          workLamp={workLamp}
          corridorOutline={shading.outline}
          nozzle={hydrant.nozzle}
          nozzleLocation={nozzleLocation}
          hydrantInterior={hydrant.interior}
          hoseBrightness={hoseBrightness}
          playerRef={playerRef}
          isThirdPerson={isThirdPerson}
          enabled={enabled}
        />

        <LobbyAvatar
          playerRef={playerRef}
          isThirdPerson={isThirdPerson}
          enabled={enabled}
          showFirstPersonBody={showFirstPersonBody}
          sidekickConfig={sidekickConfig}
          chibiConfig={chibiConfig}
          toonConfig={toonConfig}
          outlineConfig={outlineConfig}
        />
      </group>
    </>
  );
}

/** 들 수 있는 물건들의 공통 모양 값. 각 폴더가 바뀔 때만 선을 다시 뽑는다. */
function usePickupLooks(
  mug: PickupLooks["mug"],
  hatOutline: OutlineValues,
  evidence: { size: number } & OutlineValues,
  { keyboard, mouse }: { keyboard: PickupLooks["keyboard"]; mouse: PickupLooks["mouse"] },
  laptop: PickupLooks["laptop"],
) {
  const mugOutline = useMemo(() => pickOutlineValues(mug), [mug]);
  const evidenceOutline = useMemo(() => pickOutlineValues(evidence), [evidence]);
  const keyboardOutline = useMemo(() => pickOutlineValues(keyboard), [keyboard]);
  const mouseOutline = useMemo(() => pickOutlineValues(mouse), [mouse]);
  const laptopOutline = useMemo(() => pickOutlineValues(laptop), [laptop]);
  return useMemo(
    () => ({
      mug,
      mugOutline,
      // 모자는 공통 폴더 값을 통째로 선으로 쓴다(열쇠가 선 여섯 칸뿐이다)
      hatOutline,
      evidenceSize: evidence.size,
      evidenceOutline,
      keyboard,
      keyboardOutline,
      mouse,
      mouseOutline,
      laptop,
      laptopOutline,
    }),
    [
      mug,
      mugOutline,
      hatOutline,
      evidence.size,
      evidenceOutline,
      keyboard,
      keyboardOutline,
      mouse,
      mouseOutline,
      laptop,
      laptopOutline,
    ],
  );
}
