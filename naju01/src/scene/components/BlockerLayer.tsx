import type { ReactNode } from "react";

import { TOON_GRADIENT } from "@/engine/toon";

import type { PresentedControls } from "../../app/presentation";
import { MESH_NAMES } from "../../plan/meshNames";
import { UNITS_PER_METER } from "../../plan/sitePlan";
import { computeCollapseTransform } from "../../story/blockerCollapse";
import type { CollapseState } from "../useBlockerCollapse";
import type { BlockerShapes } from "../useBlockerShapes";
import type { GroundShading } from "../useNajuControls";
import type { Terrain } from "../useTerrainLayers";
import GroundMaterial from "./GroundMaterial";
import DevLabel from "./DevLabel";
import { planPoint } from "./planPoint";

const U = UNITS_PER_METER;

interface BlockerLayerProps {
  controls: PresentedControls;
  blockers: Terrain["blockers"];
  blockerShapes: BlockerShapes;
  clearedBlockers: Set<string>;
  collapse: CollapseState | null;
  shading: GroundShading;
  shade: (color: string) => string;
  outline: ReactNode;
}

/** 높이 있는 구역의 옆구리 바위와 시야 차단물(무너지는 중이면 그 모양으로). */
export default function BlockerLayer({
  controls,
  blockers,
  blockerShapes,
  clearedBlockers,
  collapse,
  shading,
  shade,
  outline,
}: BlockerLayerProps) {
  return (
    <>
      {/* 높이 있는 구역의 옆구리 — 절벽·차단물과 같은 바위 */}
      {blockerShapes?.zoneRocks.map((z) => (
        <mesh name={MESH_NAMES.zoneSides} key={`zoneRock-${z.code}`} geometry={z.geometry} receiveShadow castShadow>
          <GroundMaterial
            shading={shading}
            brightness={controls.brightness}
            doubleSided
            grain
            grainEnabled={controls.groundGrain > 0}
          />
        </mesh>
      ))}

      {/* 시야 차단물 — 끄면 회색 상자 */}
      {blockerShapes
        ? blockerShapes.pieces.map((b) => {
            // 판정은 무너짐이 끝나는 순간에만 열리므로 「보이는데 못 지나감」이 안 생긴다.
            const isCleared = clearedBlockers.has(b.code);
            const progress = collapse?.code === b.code ? collapse.progress : isCleared ? 1 : 0;
            if (isCleared && progress >= 1) return null;
            const v = computeCollapseTransform(progress, b.actualHeight ?? 4);
            return (
              <group
                key={`blocker-${b.code}`}
                position={[0, v.sink, 0]}
                scale={[1, v.squash, 1]}
                rotation={[v.tilt, 0, v.tilt * 0.4]}
              >
                <mesh name={MESH_NAMES.blockerRock} geometry={b.rock} receiveShadow castShadow>
                  <GroundMaterial shading={shading} brightness={controls.brightness} doubleSided />
                </mesh>
                {controls.showLabels && (
                  <DevLabel position={planPoint(b.center[0], b.center[1], b.top + 1.2)} color="#CBD3E0" size={11}>
                    {b.code} {b.name} · {b.role}
                  </DevLabel>
                )}
              </group>
            );
          })
        : blockers.map((b) => {
            const w = b.x[1] - b.x[0];
            const d = b.z[1] - b.z[0];
            const cx = (b.x[0] + b.x[1]) / 2;
            const cz = (b.z[0] + b.z[1]) / 2;
            const foot = b.foot ?? 0;
            const floor = b.floor ?? 0;
            return (
              <group key={b.code}>
                {floor > foot && (
                  <mesh position={planPoint(cx, cz, (foot + floor) / 2)} castShadow receiveShadow>
                    <boxGeometry args={[w * U, (floor - foot) * U, d * U]} />
                    <meshToonMaterial color={shade(controls.cliffColor)} gradientMap={TOON_GRADIENT} />
                    {outline}
                  </mesh>
                )}
                <mesh position={planPoint(cx, cz, floor + b.height / 2)} castShadow receiveShadow>
                  <boxGeometry args={[w * U, b.height * U, d * U]} />
                  <meshToonMaterial color={shade(controls.blockerColor)} gradientMap={TOON_GRADIENT} />
                  {outline}
                </mesh>
              </group>
            );
          })}
    </>
  );
}
