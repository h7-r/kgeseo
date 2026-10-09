import { MESH_NAMES } from "../../plan/meshNames";
import type { GroundShading } from "../useNajuControls";
import type { DistantLandscapeShapes } from "../useWorldLayers";
import GroundMaterial from "./GroundMaterial";

interface DistantLandscapeLayerProps {
  distantLandscape: DistantLandscapeShapes;
  shading: GroundShading;
  brightness: number;
}

/** 원경 — 산은 빛을 안 받는 실루엣, 들·숲·마을은 빛을 받는다 */
export default function DistantLandscapeLayer({ distantLandscape, shading, brightness }: DistantLandscapeLayerProps) {
  if (!distantLandscape) return null;
  return (
    <>
      <mesh name={MESH_NAMES.distantMountains} geometry={distantLandscape.mountains} frustumCulled={false}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      <mesh name={MESH_NAMES.distantFields} geometry={distantLandscape.fields} receiveShadow>
        <GroundMaterial shading={shading} brightness={brightness} doubleSided />
      </mesh>
      {/* 먼 대지 — 비면 들판이 260 m 에서 끊기고 하늘이 비쳐 다시 '섬'이 된다 */}
      <mesh name={MESH_NAMES.distantFarFields} geometry={distantLandscape.farFields} frustumCulled={false}>
        <GroundMaterial shading={shading} brightness={brightness} doubleSided />
      </mesh>
      {distantLandscape.forestVillages?.geometry && (
        <mesh name={MESH_NAMES.distantForestVillages} geometry={distantLandscape.forestVillages.geometry}>
          <GroundMaterial shading={shading} brightness={brightness} />
        </mesh>
      )}
    </>
  );
}
