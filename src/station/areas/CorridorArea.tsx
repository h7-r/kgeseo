import type { OutlineValues } from "@/engine/toon";
import CorridorClutter from "@/props/corridorClutter/CorridorClutter";
import CorridorCorrosion from "@/props/corridorClutter/CorridorCorrosion";
import type { VendingMachineState } from "@/props/vendingMachineState";
import WorkLampPuzzle from "@/props/workLampPuzzle/WorkLampPuzzle";
import BrokenDoorFrame from "@/station/corridor/BrokenDoorFrame";
import CorridorEndDoor from "@/station/corridor/CorridorEndDoor";
import CorridorPipes from "@/station/corridor/CorridorPipes";
import CorridorSideDoor from "@/station/corridor/CorridorSideDoor";
import SecretCorridor from "@/station/corridor/SecretCorridor";
import SlidingWall from "@/station/corridor/SlidingWall";
import FloorHintPaper from "@/station/hands/FloorHintPaper";
import { dynamicColliders, hit, type ColliderBox } from "@/station/layout/collision";
import { MIN_X } from "@/station/layout/dimensions";
import { TutorialDirectionArrow } from "@/tutorial/TutorialDirection";
import TutorialFloorMarker from "@/tutorial/TutorialFloorMarker";

import type { HydrantControls, PadlockControls, PanelInteriorValues } from "../controls/corridorCabinetControls";
import type { CorridorValues } from "../controls/corridorControls";
import type { SurfaceValues } from "../controls/roomControls";
import type { HighlightValues } from "../controls/systemControls";
import type { CoinValues, VendingControls } from "../controls/vendingControls";
import type { WorkLampPuzzleValues } from "../controls/workLampControls";
import CorridorCabinets from "./CorridorCabinets";
import CorridorCoins from "./CorridorCoins";
import { corridorZ, type CorridorShading } from "./corridorHooks";
import CorridorLights from "./CorridorLights";
import VendingArea from "./VendingArea";

// 문마다 때를 다르게 — 같으면 복사한 티가 난다
const SIDE_DOOR_GRIME = [1, 0.75, 1.35];
/** 복도 바닥판이 깔린 높이. 바닥에 놓는 것들이 같은 값을 써야 밑동이 안 파묻힌다. */
const CORRIDOR_FLOOR_Y = 0.01;

// 분리수거 통이 길을 막게 — 등록하고 풀기 함수를 돌려준다
const registerPuzzleCollider = (name: string, box: ColliderBox) => {
  dynamicColliders.set(name, box);
  return () => {
    dynamicColliders.delete(name);
  };
};

interface CorridorAreaProps {
  corridor: CorridorValues;
  surface: SurfaceValues;
  shading: CorridorShading;
  workLamp: WorkLampPuzzleValues;
  hydrant: HydrantControls;
  padlock: PadlockControls;
  panelInterior: PanelInteriorValues;
  vending: VendingControls;
  coin: CoinValues;
  coinOutline: OutlineValues;
  highlight: HighlightValues;
  eyeHeight: number;
  isCollisionEnabled: boolean;
  drinkMachine: VendingMachineState;
  coffeeMachine: VendingMachineState;
  hydrantDoorId: string;
  isHydrantLocked: boolean;
}

/** 비밀 복도 안의 모든 것. 「비밀 복도 › 보이기」 가 켜져 있을 때만 그린다. */
export default function CorridorArea({
  corridor,
  surface,
  shading,
  workLamp,
  hydrant,
  padlock,
  panelInterior,
  vending,
  coin,
  coinOutline,
  highlight,
  eyeHeight,
  isCollisionEnabled,
  drinkMachine,
  coffeeMachine,
  hydrantDoorId,
  isHydrantLocked,
}: CorridorAreaProps) {
  const { depthRule, brightnessAt, outline, hasPower, hasFullPower, isEndDoorReleased } = shading;
  const sideDoorSpan = Math.max(1, corridor.sideDoorCount - 1);

  return (
    <>
      <SecretCorridor
        x0={corridor.outerX}
        x1={MIN_X}
        z0={corridor.startZ}
        z1={corridor.endZ}
        height={corridor.height}
        doorZ={corridor.doorZ}
        doorWidth={corridor.doorWidth}
        doorHeight={corridor.doorHeight}
        wallColor={corridor.wallColor}
        baseboardColor={corridor.baseboardColor}
        floorColor={corridor.floorColor}
        ceilingColor={corridor.ceilingColor}
        wear={surface.wallWear + 0.4}
        floorSeed={surface.floorSeed + 11}
        rubbleCount={corridor.rubbleCount}
        rubbleColor={corridor.rubbleColor}
        roughness={corridor.roughness}
        darkness={corridor.depthDarkness}
        falloff={corridor.falloff}
        minBrightness={corridor.minBrightness}
        wallBrightness={corridor.wallBrightness}
        endDarkness={corridor.endDarkness}
        endCurve={corridor.endCurve}
        darkBoundary={depthRule.darkBoundary}
        darkFactor={depthRule.darkFactor}
        brightBoundary={depthRule.brightBoundary}
        outline={outline}
      />

      {/* 잡동사니·부식도 벽과 같은 깊이 규칙으로 어두워져야 어두운 끝에서 혼자 환하게 뜨지 않는다 */}
      {corridor.clutterVisible && (
        <CorridorClutter
          x0={corridor.outerX}
          x1={MIN_X}
          z0={corridor.startZ}
          z1={corridor.endZ}
          count={Math.round((corridor.endZ - corridor.startZ) * corridor.clutterDensity)}
          puddleCount={corridor.puddleCount}
          floorY={CORRIDOR_FLOOR_Y}
          // 물방울이 시작하는 높이 — 천장 배관 언저리
          ceilingY={corridor.height - 0.9}
          seed={surface.floorSeed + 4711}
          brightness={brightnessAt}
          size={corridor.clutterSize}
          outline={outline}
          // 자판기 두 대 앞에서는 물방울 소리가 안 들려야 한다
          quietZs={[vending.drink.z, vending.coffee.z]}
        />
      )}

      {/* 벽·바닥이 고르게 낡으면 반복 무늬가 드러난다 — 한 군데씩 썩어 들어간 얼룩이 세월로 읽힌다 */}
      {corridor.corrosionVisible && (
        <CorridorCorrosion
          x0={corridor.outerX}
          x1={MIN_X}
          z0={corridor.startZ}
          z1={corridor.endZ}
          floorY={CORRIDOR_FLOOR_Y}
          wallHeight={corridor.height}
          floorCount={corridor.corrosionFloorCount}
          wallCount={corridor.corrosionWallCount}
          crackCount={corridor.crackCount}
          size={corridor.corrosionSize}
          doorZ={corridor.doorZ}
          doorWidth={corridor.doorWidth}
          floorColor={corridor.floorColor}
          wallColor={corridor.wallColor}
          seed={surface.floorSeed + 909}
          brightness={brightnessAt}
        />
      )}

      {/* 천장을 따라 뻗은 배관·전선 트레이가 소실점으로 모여 복도가 길어 보인다 */}
      {corridor.pipesVisible && (
        <CorridorPipes
          x0={corridor.outerX}
          x1={MIN_X}
          z0={corridor.startZ}
          z1={corridor.endZ}
          height={corridor.height}
          xRatio={corridor.pipeXRatio}
          sag={corridor.pipeSag}
          largeRadius={corridor.pipeLargeRadius}
          smallRadius={corridor.pipeSmallRadius}
          trayWidth={corridor.pipeTrayWidth}
          rungSpacing={corridor.pipeRungSpacing}
          hangerSpacing={corridor.pipeHangerSpacing}
          pipeColor={corridor.pipeColor}
          trayColor={corridor.pipeTrayColor}
          hangerColor={corridor.pipeHangerColor}
          brightness={corridor.pipeBrightness}
          depth={depthRule}
          outline={outline}
        />
      )}

      <CorridorCabinets
        corridor={corridor}
        shading={shading}
        hydrant={hydrant}
        padlock={padlock}
        panelInterior={panelInterior}
        highlight={highlight}
        conduitFollowsPush={vending.secretDoor.followPipe}
        hydrantDoorId={hydrantDoorId}
        isHydrantLocked={isHydrantLocked}
      />

      {/* 바깥벽의 사무실 문들 — 시작~끝 비율 사이를 (개수-1)등분해 규칙적으로 놓는다 */}
      {corridor.sideDoorsVisible &&
        Array.from({ length: corridor.sideDoorCount }, (_, i) => {
          const t =
            corridor.sideDoorCount === 1
              ? (corridor.sideDoorStart + corridor.sideDoorEnd) / 2
              : corridor.sideDoorStart + ((corridor.sideDoorEnd - corridor.sideDoorStart) * i) / sideDoorSpan;
          const z = corridorZ(corridor, t);
          return (
            <CorridorSideDoor
              key={`sd${i}`}
              x={corridor.outerX}
              z={z}
              facing={1}
              width={corridor.sideDoorWidth}
              height={corridor.sideDoorHeight}
              doorThickness={corridor.sideDoorThickness}
              frameProtrusion={corridor.sideDoorFrameProtrusion}
              inset={corridor.sideDoorInset}
              thresholdProtrusion={corridor.sideDoorThresholdProtrusion}
              doorColor={corridor.sideDoorColor}
              revealColor={corridor.sideDoorRevealColor}
              gapColor={corridor.sideDoorGapColor}
              panelLineColor={corridor.sideDoorPanelLineColor}
              hingeColor={corridor.sideDoorHingeColor}
              knobColor={corridor.sideDoorKnobColor}
              lockPlateColor={corridor.sideDoorLockPlateColor}
              keyholeColor={corridor.sideDoorKeyholeColor}
              thresholdColor={corridor.sideDoorThresholdColor}
              boardColor={corridor.sideDoorBoardColor}
              nailColor={corridor.sideDoorNailColor}
              showOutline={corridor.sideDoorOutline}
              outlineColor={corridor.sideDoorOutlineColor}
              outlineWidth={corridor.sideDoorOutlineWidth}
              grime={corridor.sideDoorGrime * SIDE_DOOR_GRIME[i % 3]}
              // 널빤지는 일부 문에만 — 전부 막으면 패턴처럼 보인다
              boarded={corridor.sideDoorBoards && i % 2 === 0}
              seed={i + 1}
              brightness={brightnessAt(z) * corridor.sideDoorBrightness}
            />
          );
        })}

      {/* 복도 반대쪽 끝의 퍼즐. 손에 든 램프는 구역 밖(HeldItemsLayer)에서 그린다. */}
      {workLamp.visible && (
        <WorkLampPuzzle
          corridor={{ outerX: corridor.outerX, innerX: MIN_X, startZ: corridor.startZ, height: corridor.height }}
          values={workLamp}
          brightnessAt={brightnessAt}
          isBlocked={hit}
          registerCollider={registerPuzzleCollider}
          outline={outline}
        />
      )}

      {/* 복도 끝 비상계단 문 — 차단기 → 해제 버튼 → 이 문. 전기가 와야 유도등도 켜진다 */}
      {corridor.endDoorVisible && (
        <CorridorEndDoor
          x={(corridor.outerX + MIN_X) / 2}
          z={corridor.startZ}
          inward={1}
          width={corridor.endDoorWidth}
          height={corridor.endDoorHeight}
          doorColor={corridor.endDoorColor}
          frameColor={corridor.endDoorFrameColor}
          handleColor={corridor.endDoorHandleColor}
          lineColor={corridor.endDoorLineColor}
          contrast={corridor.endDoorContrast}
          casingWidth={corridor.endDoorCasingWidth}
          casingDepth={corridor.endDoorCasingDepth}
          doorThickness={corridor.endDoorThickness}
          exitSign={corridor.exitSign}
          exitSignScale={corridor.exitSignScale}
          exitSignHeight={corridor.exitSignHeight}
          exitSignRimColor={corridor.exitSignRimColor}
          exitSignColor={corridor.exitSignColor}
          openId="corridor:endDoor"
          canOpen={hasPower && isEndDoorReleased}
          exitSignLit={!workLamp.visible || !workLamp.startDark || hasPower}
          // 유도등만 basic 재질이라 이 감광을 안 받는다 — 의도한 것
          brightness={brightnessAt(corridor.startZ) * corridor.endDoorBrightness}
          outline={outline}
        />
      )}

      <FloorHintPaper outline={outline} />
      <TutorialFloorMarker />
      <TutorialDirectionArrow />

      {corridor.vendingVisible && (
        <VendingArea
          corridor={corridor}
          vending={vending}
          eyeHeight={eyeHeight}
          brightnessAt={brightnessAt}
          isCollisionEnabled={isCollisionEnabled}
          drinkMachine={drinkMachine}
          coffeeMachine={coffeeMachine}
        />
      )}

      {coin.visible && <CorridorCoins coin={coin} outline={coinOutline} />}

      {/* 구멍 테두리 — 리빌(안쪽 단면)·찢어진 가장자리·발치 잔해. 벽 구멍 자체는 방 벽을 쪼개 뚫는다. */}
      <BrokenDoorFrame
        x={MIN_X}
        doorZ={corridor.doorZ}
        doorWidth={corridor.doorWidth}
        doorHeight={corridor.doorHeight}
        thickness={corridor.doorThickness}
        wallColor={surface.wallColor}
        rubbleColor={corridor.rubbleColor}
        roughness={corridor.roughness}
        showRubble={corridor.edgeRubble}
        outline={outline}
      />
      {corridor.showBlocker && (
        <SlidingWall
          x={MIN_X}
          doorZ={corridor.doorZ}
          doorWidth={corridor.doorWidth}
          doorHeight={corridor.doorHeight}
          thickness={corridor.doorThickness}
          openness={corridor.openness}
          rubbleColor={corridor.rubbleColor}
          roughness={corridor.roughness}
          outline={outline}
        />
      )}

      {corridor.lightsOn && (
        <CorridorLights
          corridor={corridor}
          workLamp={workLamp}
          hasPower={hasPower}
          hasFullPower={hasFullPower}
          outline={outline}
        />
      )}
    </>
  );
}
