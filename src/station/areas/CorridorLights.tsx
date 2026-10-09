import type { OutlineValues } from "@/engine/toon";
import CorridorLight from "@/station/corridor/CorridorLight";
import { FLICKER_PATTERNS } from "@/station/corridor/corridorLighting";
import { HEADQUARTERS_MIN_X } from "@/station/layout/dimensions";

import type { CorridorValues } from "../controls/corridorControls";
import type { WorkLampPuzzleValues } from "../controls/workLampControls";
import { getCorridorZ } from "./corridorHooks";

// 등마다 때를 다르게 — 같은 값이면 복사한 티가 난다
const GRIME_VARIATION = [1, 1.5, 0.72];

interface CorridorLightsProps {
  corridor: CorridorValues;
  workLamp: WorkLampPuzzleValues;
  hasPower: boolean;
  hasFullPower: boolean;
  outline: OutlineValues;
}

/**
 * 천장 형광 패널등 — 복도 길이를 N 등분한 칸 한가운데마다 하나.
 * 작업등 퍼즐의 어두운 구간 등은 지우지 않고 세기 0 으로 끈다. three 는 씬의 빛 개수가 바뀌면 모든 재질을 다시
 * 컴파일한다 — 등을 빼고 넣던 때 차단기를 올리는 순간 19초 멈췄다. 개수를 고정하면 컴파일은 처음 한 번뿐이다.
 */
export default function CorridorLights({ corridor, workLamp, hasPower, hasFullPower, outline }: CorridorLightsProps) {
  return (
    <>
      {Array.from({ length: corridor.lightCount }, (_, i) => {
        const t = (i + 0.5) / corridor.lightCount;
        const z = getCorridorZ(corridor, t);
        // 차단기만 올리면(비상 전원) 퍼즐 쪽 절반만 켜지고, 분리수거 → 그림 → 시험반까지 풀어야 전부 들어온다
        const isOff =
          workLamp.visible &&
          workLamp.startDark &&
          !hasFullPower &&
          (!hasPower || z > workLamp.halfPowerBoundaryZ) &&
          z < workLamp.darkBoundaryZ;
        return (
          <CorridorLight
            key={`cl${i}`}
            x={(corridor.outerX + HEADQUARTERS_MIN_X) / 2}
            y={corridor.height - corridor.lightDrop}
            z={z}
            width={corridor.lightWidth}
            length={corridor.lightLength}
            color={corridor.lightColor}
            intensity={isOff ? 0 : corridor.lightIntensity}
            frameColor={corridor.lightFrameColor}
            panelColor={corridor.lightPanelColor}
            rotation={corridor.lightRotation}
            angle={corridor.lightAngle}
            penumbra={corridor.lightPenumbra}
            distance={corridor.lightDistance}
            grime={corridor.lightGrime * GRIME_VARIATION[i % 3]}
            // 꺼진 등도 기구는 희미하게 남아야 「저기 등이 있는데 안 켜졌다」가 읽힌다
            glow={isOff ? 0.05 : corridor.lightGlow}
            flicker={!isOff && corridor.flicker}
            // 레버를 올리면 차단기함에서 방 쪽으로 한 칸씩 흘러가듯 켜진다(유닛당 0.03초)
            turnOnDelay={Math.max(0, (z - workLamp.breakerZ) * 0.03)}
            stainSeed={i + 1}
            pattern={FLICKER_PATTERNS[i % FLICKER_PATTERNS.length]}
            outline={outline}
          />
        );
      })}
    </>
  );
}
