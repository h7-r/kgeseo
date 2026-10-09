import * as THREE from "three";

import { TOON_GRADIENT } from "@/engine/toon";

import type { PresentedControls } from "../../app/presentation";
import { MESH_NAMES } from "../../plan/meshNames";
import { CORE, RIVER, UNITS_PER_METER } from "../../plan/sitePlan";
import type { GroundShading } from "../useNajuControls";
import type { RiverShapes } from "../useWorldLayers";
import GroundMaterial from "./GroundMaterial";
import DevLabel from "./DevLabel";
import { planPoint } from "./planPoint";

const U = UNITS_PER_METER;

interface WaterLayerProps {
  controls: PresentedControls;
  river: RiverShapes;
  shading: GroundShading;
  shade: (color: string) => string;
  rippleMaterialRef: (material: THREE.Material | null) => void;
}

/** 영산강 — 강디테일을 끄면 민판 한 장. */
export default function WaterLayer({ controls, river, shading, shade, rippleMaterialRef }: WaterLayerProps) {
  const coreWidth = CORE.x[1] - CORE.x[0];
  return (
    <>
      {river ? (
        <>
          {/* 건너편 능선은 원경이라 빛을 안 받는다 — 음영을 주면 오히려 가깝게 보인다 */}
          {river.farBank && (
            <mesh name={MESH_NAMES.riverFarBank} geometry={river.farBank}>
              <meshBasicMaterial vertexColors toneMapped={false} />
            </mesh>
          )}
          {/* 수면 재질에만 ref 를 단다 — 재질이 바뀌어도 잔결이 다시 걸린다 */}
          <mesh
            name={MESH_NAMES.riverSurface}
            geometry={river.surface.geometry}
            receiveShadow={controls.waterReceivesShadow}
          >
            <GroundMaterial shading={shading} brightness={controls.brightness} materialRef={rippleMaterialRef} />
          </mesh>
          {river.stones && (
            <mesh name={MESH_NAMES.riverStones} geometry={river.stones} receiveShadow castShadow>
              <GroundMaterial shading={shading} brightness={controls.brightness} />
            </mesh>
          )}
        </>
      ) : (
        <mesh position={planPoint(coreWidth / 2, (RIVER.zStart + RIVER.zEnd) / 2, -0.35)} receiveShadow>
          <boxGeometry args={[coreWidth * U, 0.35 * U, (RIVER.zEnd - RIVER.zStart) * U]} />
          <meshToonMaterial color={shade(controls.riverColor)} gradientMap={TOON_GRADIENT} />
        </mesh>
      )}
      {controls.showLabels && (
        <DevLabel position={planPoint(70, 47, 1)} color="#BFE0F2">
          {RIVER.name} · 방향 앵커(§4)
        </DevLabel>
      )}
    </>
  );
}
