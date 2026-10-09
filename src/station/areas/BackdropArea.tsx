import {
  HEADQUARTERS_MAX_Z,
  HEADQUARTERS_MIN_Z,
  HEADQUARTERS_CENTER_Z,
  HEADQUARTERS_H,
} from "@/station/layout/dimensions";
import PlatformExtension from "@/station/train/PlatformExtension";
import TrainBackdrop from "@/station/train/TrainBackdrop";

import type { SurfaceValues } from "../controls/headquartersControls";
import type { BackdropValues } from "../controls/trainControls";

interface BackdropAreaProps {
  backdrop: BackdropValues;
  surface: SurfaceValues;
}

/** 기차 저편 — 맨 뒤 어둠판과, 벽·천장을 기차 너머까지 이어 붙인 승강장. */
export default function BackdropArea({ backdrop: bg, surface }: BackdropAreaProps) {
  return (
    <>
      {bg.hasDarkPanel && (
        <TrainBackdrop
          x={bg.darkPanelDistance}
          z={HEADQUARTERS_CENTER_Z}
          color={bg.darkColor}
          floorColor={bg.floorColor}
          floorY={bg.floorY}
        />
      )}
      {bg.extend && (
        <PlatformExtension
          startX={16}
          endX={bg.farWallX}
          // 기차(71유닛)가 방(26유닛) 밖으로 한참 빠져나가 앞뒤로 8유닛씩 더 길게 — 방 모서리 너머로 시선이 샌다
          z0={HEADQUARTERS_MIN_Z - 8}
          z1={HEADQUARTERS_MAX_Z + 8}
          height={HEADQUARTERS_H}
          hasFarWall={bg.hasFarWall}
          hasCeiling={bg.hasCeiling}
          hasUtilities={bg.hasUtilities}
          ductPlacement={bg.ductPlacement}
          ductDrop={bg.ductDrop}
          ductWidth={bg.ductWidth}
          ductHeight={bg.ductHeight}
          jointSpacing={bg.jointSpacing}
          pipePlacement={bg.pipePlacement}
          pipeDrop={bg.pipeDrop}
          pipeCount={bg.pipeCount}
          pipeRadius={bg.pipeRadius}
          pipeSpacing={bg.pipeSpacing}
          hangerSpacing={bg.hangerSpacing}
          ductColor={bg.ductColor}
          pipeColor={bg.pipeColor}
          insulationColor={bg.insulationColor}
          hasFloor={bg.hasTrackFloor}
          floorY={bg.trackFloorY}
          floorColor={bg.trackFloorColor}
          floorSeed={surface.floorSeed + 3}
          floorStain={bg.trackFloorStain}
          wallColor={bg.farWallColor}
          baseColor={surface.wallBaseColor}
          ceilingColor={bg.ceilingColor}
          ceilingSeed={surface.ceilingSeed}
          ceilingWear={surface.ceilingWear}
          tileSize={bg.tileSize}
          collapse={bg.collapse}
          sag={bg.sag}
          hasFrame={bg.hasFrame}
          frameSpacing={bg.frameSpacing}
          frameThickness={bg.frameThickness}
          frameColor={bg.frameColor}
          hasHangingPanels={bg.hasHangingPanels}
          wear={surface.wallWear}
          seed={surface.wallSeed + 5}
        />
      )}
    </>
  );
}
