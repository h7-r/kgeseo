import { MESH_NAMES } from "../../plan/meshNames";
import type { GroundShading } from "../useNajuControls";
import type { DistantLayer as DistantLayerData } from "../useWorldLayers";
import GroundMaterial from "./GroundMaterial";

interface DistantLayerProps {
  distant: DistantLayerData;
  shading: GroundShading;
  brightness: number;
}

/** 원경 — 산은 빛을 안 받는 실루엣, 들·숲·마을은 빛을 받는다 */
export default function DistantLayer({ distant, shading, brightness }: DistantLayerProps) {
  if (!distant) return null;
  return (
    <>
      <mesh name={MESH_NAMES.distantMountains} geometry={distant.mountains} frustumCulled={false}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      <mesh name={MESH_NAMES.distantFields} geometry={distant.fields} receiveShadow>
        <GroundMaterial shading={shading} brightness={brightness} doubleSided />
      </mesh>
      {/* 먼 대지 — 비면 들판이 260 m 에서 끊기고 하늘이 비쳐 다시 '섬'이 된다 */}
      <mesh name={MESH_NAMES.distantFarFields} geometry={distant.farFields} frustumCulled={false}>
        <GroundMaterial shading={shading} brightness={brightness} doubleSided />
      </mesh>
      {distant.forestVillages?.geometry && (
        <mesh name={MESH_NAMES.distantForestVillages} geometry={distant.forestVillages.geometry}>
          <GroundMaterial shading={shading} brightness={brightness} />
        </mesh>
      )}
    </>
  );
}
