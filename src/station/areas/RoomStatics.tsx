/**
 * 방에서 로비 상태와 상관없는 묶음들. 같은 props 면 memo 가 가지를 통째로 건너뛴다 —
 * Scene 은 로비 상태(서랍·든 것·의자)를 구독해 자주 다시 그려진다.
 * Leva 값은 값이 그대로면 같은 객체라 props 로 그대로 넘겨도 된다.
 */
import { memo, Suspense, useMemo } from "react";

import { pickOutline } from "@/engine/leva/savedControls";
import type { OutlineValues } from "@/engine/toon";
import { MeasureItem } from "@/lobby/PlacementViews";
import { AutoCollider } from "@/station/layout/Colliders";
import { PALETTE } from "@/station/layout/dimensions";
import CoatRack from "@/station/office/CoatRack";
import Desk from "@/station/office/Desk";
import PcSet from "@/station/office/PcSet";
import WorkLamp from "@/station/office/WorkLamp";
import type { StructureOutline } from "@/station/room/RoomShell";

import type { CoatRackControls, DeskCommonValues, DeskValues } from "../controls/furnitureControls";
import type { ComputerControls } from "../controls/officePropControls";
import type { CeilingLightValues } from "../controls/roomControls";
import type { CollisionValues } from "../controls/systemControls";

// 2×2 균일 격자. 실제 빛은 여기서 나온다.
const CEILING_LAMP_SPOTS: readonly [number, number][] = [
  [-8, -7],
  [8, -7],
  [-8, 7],
  [8, 7],
];

interface CeilingLightsProps {
  light: CeilingLightValues;
  /** 「스탠드(공통) › 천장등끄기」 */
  isForcedOff: boolean;
  outline: StructureOutline;
}

/** 천장 작업등 넷 — 수사본부가 낡은 천장에 새로 매단 반구 갓 조명. */
export const CeilingLights = memo(function CeilingLights({ light, isForcedOff, outline }: CeilingLightsProps) {
  // 갓은 방 구조물 선 중 외곽선만 쓰고 주름선은 끈다.
  const lampOutline = useMemo<OutlineValues>(
    () => ({
      outline: outline.outline,
      outlineWidth: outline.outlineWidth,
      outlineColor: outline.outlineColor,
      crease: false,
      creaseAngle: 40,
      creaseColor: "#000000",
    }),
    [outline],
  );
  return (
    <>
      {CEILING_LAMP_SPOTS.map(([x, z], i) => (
        <WorkLamp
          key={`ceil${i}`}
          pos={[x, z]}
          on={light.on && !isForcedOff}
          drop={light.drop}
          size={light.size}
          shadeColor={light.shadeColor}
          bulbColor={light.bulbColor}
          intensity={light.intensity}
          spread={light.spread}
          glow={light.glow}
          decay={light.decay}
          ceilingGlow={light.ceilingGlow}
          outline={lampOutline}
        />
      ))}
    </>
  );
});

interface CoatRacksProps {
  common: CoatRackControls["common"];
  rack1: CoatRackControls["rack1"];
  rack2: CoatRackControls["rack2"];
  collision: CollisionValues;
}

/** 옷걸이 스탠드 둘. */
export const CoatRacks = memo(function CoatRacks({ common, rack1, rack2, collision }: CoatRacksProps) {
  const outline = useMemo(() => pickOutline(common), [common]);
  if (!common.visible) return null;
  return (
    <>
      {[rack1, rack2].map((rack, i) => (
        <AutoCollider
          key={`rack${i}`}
          name={`rack${i}`}
          enabled={collision.enabled}
          margin={collision.margin}
          remeasureKey={`${rack.x},${rack.z},${rack.rotation},${common.standHeight}`}
        >
          <group position={[rack.x, 0, rack.z]} rotation={[0, rack.rotation, 0]}>
            <CoatRack
              outline={outline}
              standColor={common.standColor}
              coatColor={rack.coatColor}
              height={common.standHeight}
              mirrored={rack.mirrored}
            />
          </group>
        </AutoCollider>
      ))}
    </>
  );
});

interface DesksProps {
  desks: readonly DeskValues[];
  common: DeskCommonValues;
  collision: CollisionValues;
}

/** 철제 책상 다섯. 윗면을 「놓을 수 있는 면」으로 잰다. */
export const Desks = memo(function Desks({ desks, common, collision }: DesksProps) {
  const outline = useMemo(() => pickOutline(common), [common]);
  return (
    <Suspense fallback={null}>
      {desks.map((d, i) => (
        <AutoCollider
          key={`desk${i}`}
          name={`desk${i}`}
          enabled={collision.enabled}
          margin={collision.margin}
          remeasureKey={`${d.x},${d.z},${d.rotation},${d.width},${d.depth},${common.size}`}
        >
          <MeasureItem
            id={`surface:desk${i}`}
            isSurface
            remeasureKey={`${d.x},${d.z},${d.rotation},${d.width},${d.depth},${d.height},${common.size},${common.lift}`}
          >
            <Desk
              pos={[d.x, d.z]}
              rot={d.rotation}
              stretch={d.width}
              zStretch={d.depth}
              yStretch={d.height}
              scale={common.size}
              lift={common.lift}
              outline={outline}
              color={PALETTE.struct}
            />
          </MeasureItem>
        </AutoCollider>
      ))}
    </Suspense>
  );
});

interface ComputersProps {
  common: ComputerControls["common"];
  monitors: ComputerControls["monitors"];
}

/** 책상 위 모니터 두 대. 크기·색은 공통 폴더, 자리는 대마다. */
export const Computers = memo(function Computers({ common, monitors }: ComputersProps) {
  const outline = useMemo(() => pickOutline(common), [common]);
  return (
    <Suspense fallback={null}>
      {monitors.map((p, i) => (
        <MeasureItem
          key={`pc${i}`}
          id={`pc${i}`}
          occupiesSpace
          remeasureKey={`${p.x},${p.z},${p.rotation},${p.height},${p.sizeMul},${common.size}`}
        >
          <PcSet
            outline={outline}
            pos={[p.x, p.z]}
            rot={p.rotation}
            y={p.height}
            scale={common.size}
            sizeMul={p.sizeMul}
            color={common.color}
          />
        </MeasureItem>
      ))}
    </Suspense>
  );
});
