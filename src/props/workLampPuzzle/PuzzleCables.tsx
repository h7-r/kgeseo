import type { WorkLampPuzzleValues } from "./controls";
import { BIN_SIZE, PAINTING_HEIGHT_PX, PAINTING_WIDTH_PX } from "./dimensions";
import PowerCable from "./PowerCable";

interface PuzzleCablesProps {
  values: Pick<
    WorkLampPuzzleValues,
    | "paintingZ"
    | "paintingY"
    | "paintingWidth"
    | "switchPanelY"
    | "switchPanelSide"
    | "binGeneralZ"
    | "binPlasticZ"
    | "binOffset"
  >;
  outerX: number;
  innerX: number;
  corridorHeight: number | null;
  brightnessAt: (z: number) => number;
}

/**
 * 퍼즐을 잇는 전선 — 액자 → 시험반 짧은 관(스위치가 그림에서 전기를 받는 물건으로 읽힌다)과
 * 통마다 한 가닥씩 바깥벽 → 천장 → 안쪽벽 → 액자로 가는 선.
 */
export default function PuzzleCables({ values: v, outerX, innerX, corridorHeight, brightnessAt }: PuzzleCablesProps) {
  const paintingHeight = v.paintingWidth * (PAINTING_HEIGHT_PX / PAINTING_WIDTH_PX);
  const frameEnd = v.paintingZ - (v.paintingWidth / 2 + 0.24);
  const panelEnd = v.paintingZ + v.switchPanelSide + (0.24 * 5 + 0.3) / 2;
  const panelCableX = innerX - 0.06;
  const ceiling = (corridorHeight ?? 8) - 0.28;
  const outerWireX = outerX + 0.06;
  const innerWireX = innerX - 0.06;
  const frameTop = v.paintingY + paintingHeight / 2 + 0.24;
  const binCables = [
    ["general", v.binGeneralZ, -1],
    ["plastic", v.binPlasticZ, 1],
  ] as const;
  return (
    <>
      <PowerCable
        bin={null}
        brightness={brightnessAt(v.paintingZ)}
        points={[
          [panelCableX, v.paintingY - paintingHeight * 0.25, frameEnd + 0.02],
          [panelCableX, v.paintingY - paintingHeight * 0.25, (frameEnd + panelEnd) / 2],
          [panelCableX, v.switchPanelY + 0.2, (frameEnd + panelEnd) / 2],
          [panelCableX, v.switchPanelY + 0.2, panelEnd - 0.02],
        ]}
      />
      {binCables.map(([bin, z, side]) => {
        const frameZ = v.paintingZ + side * (v.paintingWidth / 2 - 0.1);
        return (
          <PowerCable
            key={bin}
            bin={bin}
            brightness={brightnessAt(z)}
            points={[
              [outerX + v.binOffset + 0.08, BIN_SIZE.bodyHeight - 0.1, z],
              [outerWireX, BIN_SIZE.bodyHeight - 0.1, z],
              [outerWireX, ceiling, z],
              [(outerWireX + innerWireX) / 2, ceiling, (z + frameZ) / 2],
              [innerWireX, ceiling, frameZ],
              [innerWireX, frameTop, frameZ],
              [innerWireX - 0.12, frameTop - 0.06, frameZ],
            ]}
          />
        );
      })}
    </>
  );
}
