import { Suspense, useMemo } from "react";

import { pickOutline } from "@/engine/leva/savedControls";
import { MAX_Z, MIN_Z, ROOM_H } from "@/station/layout/dimensions";
import BrokenWallEnd from "@/station/train/BrokenWallEnd";
import PlatformEndWall from "@/station/train/PlatformEndWall";
import Train from "@/station/train/Train";
import TrainTracks from "@/station/train/TrainTracks";

import type { SurfaceValues } from "../controls/roomControls";
import type { PlatformEndWallValues, TrainControls } from "../controls/trainControls";

/** 기차 모델 반폭 비율(모델 폭 0.686 ÷ 2). 끝벽 구멍을 기차 크기에서 계산한다. */
const TRAIN_HALF_WIDTH = 0.343;

interface TrainAreaProps {
  train: TrainControls;
  endWall: PlatformEndWallValues;
  surface: SurfaceValues;
}

/** 승강장 끝벽 → 선로 → 부서진 벽 끝 → 멈춰 선 기차. */
export default function TrainArea({ train: controls, endWall, surface }: TrainAreaProps) {
  const { train, door, step, tracks, brokenWall, backdrop } = controls;
  const trainOutline = useMemo(() => pickOutline(train), [train]);
  const tracksOutline = useMemo(() => pickOutline(tracks), [tracks]);
  const brokenWallOutline = useMemo(() => pickOutline(brokenWall), [brokenWall]);
  const endWallOutline = useMemo(() => pickOutline(endWall), [endWall]);

  return (
    <>
      {endWall.visible &&
        backdrop.extend &&
        (
          [
            [endWall.frontZ, false, 51],
            [endWall.backZ, true, 63],
          ] as const
        ).map(([z, flipped, seed]) => (
          <PlatformEndWall
            key={`endwall${seed}`}
            z={z}
            flipped={flipped}
            startX={16}
            endX={backdrop.farWallX}
            height={ROOM_H}
            holeX0={train.x - TRAIN_HALF_WIDTH * train.size - endWall.holeMargin}
            holeX1={train.x + TRAIN_HALF_WIDTH * train.size + endWall.holeMargin}
            holeHeight={endWall.holeHeight}
            strips={endWall.strips}
            jaggedness={endWall.jaggedness}
            wallColor={surface.wallColor}
            baseColor={surface.wallBaseColor}
            wear={surface.wallWear}
            hasRubble={endWall.hasRubble}
            rubbleColor={endWall.rubbleColor}
            roughness={endWall.roughness}
            seed={seed}
            outline={endWallOutline}
          />
        ))}

      {/* 위치는 기차와 같고 회전만 따로 둘 수 있다 */}
      {tracks.visible && (
        <TrainTracks
          position={[train.x, train.z]}
          y={tracks.y}
          rotation={tracks.matchTrainAngle ? train.rotation : tracks.rotation}
          length={tracks.length}
          width={tracks.width}
          gauge={tracks.gauge}
          hasGravel={tracks.hasGravel}
          ballastColor={tracks.ballastColor}
          sleeperColor={tracks.sleeperColor}
          railColor={tracks.railColor}
          outline={tracksOutline}
        />
      )}

      {brokenWall.visible &&
        (
          [
            [MIN_Z, 3, false, brokenWall.frontEndX, brokenWall.frontLimitX],
            [MAX_Z, 8, true, brokenWall.backEndX, brokenWall.backLimitX],
          ] as const
        ).map(([z, seed, flipped, endX, limitX]) => (
          <BrokenWallEnd
            key={`wreck${seed}`}
            z={z}
            flipped={flipped}
            endX={endX}
            limitX={limitX}
            centerCut={brokenWall.centerCut}
            layers={brokenWall.layers}
            jaggedness={brokenWall.jaggedness}
            roughness={brokenWall.roughness}
            seed={seed}
            height={ROOM_H}
            wallColor={surface.wallColor}
            baseColor={surface.wallBaseColor}
            wear={surface.wallWear}
            rubbleColor={brokenWall.rubbleColor}
            outline={brokenWallOutline}
          />
        ))}

      {train.visible && (
        <Suspense fallback={null}>
          <Train
            position={[train.x, train.z]}
            y={train.floorY}
            rotation={train.rotation}
            size={train.size}
            cars={train.cars}
            spacing={train.spacing}
            roll={train.roll}
            pitch={train.pitch}
            bend={train.bend}
            bodyColor={train.bodyColor}
            // 「기차」 폴더의 문색이 아니라 「기차 외부 문」 의 문색을 쓴다
            doorColor={door.doorColor}
            darkColor={train.darkColor}
            doorOpenWidth={train.doorOpenWidth}
            doorOptions={door}
            step={step}
            outline={trainOutline}
          />
        </Suspense>
      )}
    </>
  );
}
