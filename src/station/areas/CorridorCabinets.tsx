import type { OutlineValues } from "@/engine/toon";
import ElectricPanelInterior, { type ElectricPanelInteriorProps } from "@/props/electricPanel/ElectricPanelInterior";
import HydrantCabinetInterior, {
  type HydrantCabinetInteriorProps,
} from "@/props/hydrantCabinet/HydrantCabinetInterior";
import CombinationPadlock from "@/props/padlock/CombinationPadlock";
import { submitFireCabinetLock } from "@/server/playSession";
import WallCabinet from "@/station/corridor/WallCabinet";

import type { CorridorValues } from "../controls/corridorControls";
import type { HydrantControls } from "../controls/hydrantControls";
import type { HighlightValues } from "../controls/interactionControls";
import type { PadlockControls } from "../controls/lockControls";
import type { PanelInteriorValues } from "../controls/panelControls";
import type { CorridorShading } from "./corridorHooks";
import { wallCabinetSpots } from "./corridorHooks";

/**
 * 두 함을 그리는 자리에만 더하는 올림. 중심(3.375)이 눈높이(4.15)보다 0.8 가까이 낮았다.
 * Leva 저장값(바닥높이·자물쇠 y)은 그대로 두고 여기서만 더해 맞춰 둔 값이 안 날아간다. 자물쇠도 같이 올려야 손잡이에 걸린다.
 */
const WALL_CABINET_LIFT = 0.6;

// 원본은 소화전 속 부품에 선 네 칸(외곽선·굵기·색·주름선)만 넘겨 주름선 각도·색이 비어 있었다.
// 그러면 three 기본값으로 그려진다 — EdgesGeometry 문턱 1°, LineBasicMaterial 흰색. 화면이 같도록 그 값을 그대로 적는다.
const EDGES_DEFAULT_ANGLE = 1;
const LINE_DEFAULT_COLOR = "#ffffff";

/** T 의 열쇠가 전부 Props 에 있어야 한다 — JSX 펼치기는 남는 열쇠를 검사하지 않아 이름이 어긋나도 조용히 묻힌다. */
type PropsOnly<T, Props> = Exclude<keyof T, keyof Props> extends never ? T : never;

/** Leva 폴더 값에서 선 여섯 칸과 나머지(부품 모양)를 가른다. */
function splitOutline<T extends OutlineValues>(values: T) {
  const { outline, outlineWidth, outlineColor, crease, creaseAngle, creaseColor, ...look } = values;
  const lines: OutlineValues = { outline, outlineWidth, outlineColor, crease, creaseAngle, creaseColor };
  return [lines, look] as const;
}

interface CorridorCabinetsProps {
  corridor: CorridorValues;
  shading: CorridorShading;
  hydrant: HydrantControls;
  padlock: PadlockControls;
  panelInterior: PanelInteriorValues;
  highlight: HighlightValues;
  /** 소화전 밑 배선관 끝이 밀리는 자판기를 따라가나(「자판기 비밀문」) */
  conduitFollowsPush: boolean;
  hydrantDoorId: string;
  isHydrantLocked: boolean;
}

/** 벽 부착함 두 개(배전반·소화전)와 소화전 번호 자물쇠. 밝기는 벽·문과 같은 규칙으로 깎는다. */
export default function CorridorCabinets({
  corridor,
  shading,
  hydrant,
  padlock: { padlock, doorLatch, frameLatch },
  panelInterior,
  highlight,
  conduitFollowsPush,
  hydrantDoorId,
  isHydrantLocked,
}: CorridorCabinetsProps) {
  const { outline, brightnessAt } = shading;
  const spots = wallCabinetSpots(corridor);
  const hydrantBrightness = brightnessAt(spots.hydrant.z) * corridor.wallBrightness;

  const [panelOutline, panelRest] = splitOutline(panelInterior);
  const panelLook: PropsOnly<typeof panelRest, ElectricPanelInteriorProps> = panelRest;
  const [hydrantFolderOutline, hydrantRest] = splitOutline(hydrant.interior);
  const hydrantLook: PropsOnly<typeof hydrantRest, HydrantCabinetInteriorProps> = hydrantRest;
  const hydrantOutline: OutlineValues = {
    ...hydrantFolderOutline,
    creaseAngle: EDGES_DEFAULT_ANGLE,
    creaseColor: LINE_DEFAULT_COLOR,
  };
  const { conduit } = hydrant;

  return (
    <>
      {corridor.panelVisible && (
        <WallCabinet
          kind="panel"
          x={spots.panel.x}
          z={spots.panel.z}
          facing={1}
          width={corridor.panelWidth}
          height={corridor.panelHeight}
          depth={corridor.panelDepth}
          baseHeight={corridor.panelBaseHeight + WALL_CABINET_LIFT}
          bodyColor={corridor.panelColor}
          doorColor={corridor.panelDoorColor}
          fittingColor={corridor.cabinetFittingColor}
          labelColor={corridor.panelLabelColor}
          lineColor={outline.outlineColor}
          number={corridor.panelNumber}
          grime={corridor.cabinetGrime}
          conduit={corridor.panelConduit}
          canOpen
          openAngle={corridor.panelDoorOpenAngle}
          ceilingHeight={corridor.height}
          conduitColor={corridor.pipeColor}
          brightness={brightnessAt(spots.panel.z) * corridor.wallBrightness}
          renderInterior={({ doorId, isDoorOpen, width, height, depth, facing, brightness }) => (
            <ElectricPanelInterior
              {...panelLook}
              width={width}
              height={height}
              depth={depth}
              d={facing}
              panelId={doorId}
              canHandle={isDoorOpen}
              highlight={highlight}
              // 꽂힌 관창은 소화전함에서 온 그 자루라 색도 그쪽을 따른다
              nozzleColor={hydrant.interior.metalColor}
              brightness={brightness}
              outline={panelOutline}
            />
          )}
          outline={outline}
        />
      )}
      {corridor.hydrantVisible && (
        <WallCabinet
          kind="hydrant"
          x={spots.hydrant.x}
          z={spots.hydrant.z}
          facing={-1}
          width={corridor.hydrantWidth}
          height={corridor.hydrantHeight}
          depth={corridor.hydrantDepth}
          baseHeight={corridor.hydrantBaseHeight + WALL_CABINET_LIFT}
          bodyColor={corridor.hydrantColor}
          doorColor={corridor.hydrantDoorColor}
          fittingColor={corridor.cabinetFittingColor}
          labelColor={corridor.hydrantLabelColor}
          lineColor={outline.outlineColor}
          grime={corridor.cabinetGrime}
          conduit={conduit.visible}
          conduitShape="downSide"
          conduitEndZ={conduit.endZ}
          conduitFollowsPush={conduitFollowsPush}
          conduitBendHeight={conduit.bendHeight}
          conduitSpacing={conduit.spacing}
          conduitLevelGap={conduit.levelGap}
          conduitBendRadius={conduit.bendRadius}
          conduitRadius={conduit.radius}
          conduitForward={conduit.forward}
          conduitOffset={conduit.offset}
          ceilingHeight={corridor.height}
          conduitColor={conduit.color}
          canOpen
          locked={isHydrantLocked}
          openAngle={corridor.hydrantDoorOpenAngle}
          brightness={hydrantBrightness}
          renderInterior={({ doorId, isDoorOpen, width, height, depth, facing, brightness }) => (
            <HydrantCabinetInterior
              {...hydrantLook}
              width={width}
              height={height}
              depth={depth}
              d={facing}
              valveColor={corridor.hydrantLabelColor}
              // 관창은 문이 열려 있을 때만 [E] 로 집는다
              canHandle={isDoorOpen}
              cabinetId={doorId}
              highlight={highlight}
              brightness={brightness}
              outline={hydrantOutline}
            />
          )}
          outline={outline}
        />
      )}
      {/* 자물쇠를 숨겨도 걸쇠는 남아야 해서 셋 중 하나라도 켜져 있으면 그린다 */}
      {(padlock.visible || doorLatch.visible || frameLatch.visible) && (
        <CombinationPadlock
          position={[padlock.x, padlock.y + WALL_CABINET_LIFT, padlock.z]}
          rotation={[0, (padlock.rotationDeg * Math.PI) / 180, 0]}
          lockX={padlock.lockX}
          lockY={padlock.lockY}
          lockZ={padlock.lockZ}
          lockVisible={padlock.visible}
          showPath={padlock.showPathWhenHidden}
          size={padlock.size}
          width={padlock.width}
          height={padlock.height}
          depth={padlock.depth}
          sideRoundness={padlock.sideRoundness}
          lockId={hydrantDoorId}
          answer={padlock.answer}
          submit={submitFireCabinetLock}
          handleDistance={padlock.handleDistance}
          shackleRadius={padlock.shackleRadius}
          shackleThickness={padlock.shackleThickness}
          shackleHeight={padlock.shackleHeight}
          rowCount={padlock.rowCount}
          dialSpan={padlock.dialSpan}
          glyphPool={padlock.glyphPool}
          glyphsPerRow={padlock.glyphsPerRow}
          glyphSeed={padlock.glyphSeed}
          initialDigits={[padlock.digit1, padlock.digit2, padlock.digit3, padlock.digit4, padlock.digit5]}
          doorLatch={doorLatch}
          frameLatch={frameLatch}
          metalColor={padlock.metalColor}
          dialColor={padlock.dialColor}
          glyphColor={padlock.glyphColor}
          dividers={padlock.dividers}
          dividerColor={padlock.dividerColor}
          dividerWidth={padlock.dividerWidth}
          dividerHeight={padlock.dividerHeight}
          marker={padlock.marker}
          markerColor={padlock.markerColor}
          markerSize={padlock.markerSize}
          brightness={hydrantBrightness}
          outline={outline}
        />
      )}
    </>
  );
}
