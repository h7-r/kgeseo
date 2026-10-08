import type { ReactNode } from "react";
import * as THREE from "three";

import type { PresentedControls } from "../../app/presentation";
import type { loadRock } from "../../loaders/rockAssets";
import { MESH_NAMES } from "../../plan/meshNames";
import { UNITS_PER_METER } from "../../plan/sitePlan";
import type { BakedTerrain } from "../../terrain/useBakedTerrain";
import type { GroundShading } from "../useNajuControls";
import type { CliffPieces, GroundLayer as GroundLayerData, Terrain } from "../useTerrainLayers";
import GroundMaterial from "./GroundMaterial";
import Label from "./Label";
import { planPoint } from "./planPoint";
import SlopeSegment from "./SlopeSegment";

const U = UNITS_PER_METER;

interface GroundLayerProps {
  controls: PresentedControls;
  terrain: Terrain;
  ground: GroundLayerData;
  bakedTerrain: BakedTerrain;
  isBakedTerrainOn: boolean;
  grass: THREE.BufferGeometry[] | null;
  cliffPieces: CliffPieces;
  rockAsset: Awaited<ReturnType<typeof loadRock>>;
  shading: GroundShading;
  shade: (color: string) => string;
  outline: ReactNode;
}

/** 구역 라벨·바닥·풀·절벽. */
export default function GroundLayer({
  controls: T,
  terrain,
  ground,
  bakedTerrain,
  isBakedTerrainOn,
  grass,
  cliffPieces,
  rockAsset,
  shading,
  shade,
  outline,
}: GroundLayerProps) {
  const { zones, cliff } = terrain;
  return (
    <>
      {T.showLabels &&
        zones.map((z) => (
          <Label
            key={`zone-${z.code}`}
            position={planPoint((z.x[0] + z.x[1]) / 2, (z.z[0] + z.z[1]) / 2, z.elevation + 2.2)}
          >
            {z.code} {z.name} · {z.dimensionsLabel} · {z.scenes}
          </Label>
        ))}

      {/* 블렌더가 구운 땅 — GLB 는 도면 미터라 scale 이 전부다. castShadow 는 116 → 40 fps 라 주지 않는다. */}
      {isBakedTerrainOn && (
        <mesh name={MESH_NAMES.ground} geometry={bakedTerrain.geometry ?? undefined} scale={U} receiveShadow>
          <GroundMaterial shading={shading} brightness={T.brightness} grain grainEnabled={T.groundGrain > 0} />
        </mesh>
      )}
      {!isBakedTerrainOn && ground.mesh && (
        <mesh name={MESH_NAMES.ground} geometry={ground.mesh} receiveShadow>
          <GroundMaterial shading={shading} brightness={T.brightness} grain grainEnabled={T.groundGrain > 0} />
        </mesh>
      )}

      {grass?.map((g, i) => (
        <mesh name={MESH_NAMES.grass} key={`grass-${i}`} geometry={g} receiveShadow>
          <GroundMaterial shading={shading} brightness={T.brightness} doubleSided />
        </mesh>
      ))}

      {/* 절벽 — 끄면 민판 한 장으로 돌아가 「매끈한 판은 높이가 안 읽힌다」를 바로 비교한다 */}
      {cliffPieces ? (
        <>
          {/* 새 땅에는 절벽도 들어 있어 같이 그리면 z 싸움을 한다. 닫힌 덩어리라 양면이어야 검은 쐐기가 안 난다. */}
          {!isBakedTerrainOn && (
            <mesh name={MESH_NAMES.cliffFace} geometry={cliffPieces.face} receiveShadow castShadow>
              <GroundMaterial
                shading={shading}
                brightness={T.brightness}
                doubleSided
                grain
                grainEnabled={T.groundGrain > 0}
              />
            </mesh>
          )}
          {cliffPieces.scree && (
            <mesh name={MESH_NAMES.cliffScree} geometry={cliffPieces.scree} receiveShadow castShadow>
              <GroundMaterial shading={shading} brightness={T.brightness} />
            </mesh>
          )}
          {rockAsset && (
            <mesh
              name={MESH_NAMES.rockAsset}
              geometry={rockAsset.geometry}
              position={planPoint(T.rockAssetX, T.rockAssetZ, T.rockAssetY)}
              rotation={[0, (T.rockAssetRotation * Math.PI) / 180, 0]}
              receiveShadow
              castShadow
            >
              <GroundMaterial shading={shading} brightness={T.brightness} doubleSided />
            </mesh>
          )}
        </>
      ) : (
        <SlopeSegment
          a={[(cliff.x[0] + cliff.x[1]) / 2, cliff.zTop, cliff.height]}
          b={[(cliff.x[0] + cliff.x[1]) / 2, cliff.zBottom, 0]}
          width={cliff.x[1] - cliff.x[0]}
          thickness={0.6}
          color={shade(T.cliffColor)}
          outline={outline}
        />
      )}
      {T.showLabels && (
        <Label position={planPoint(45, 28, 7)} color="#E8DCC0">
          {cliff.name} H = {cliff.height} m · 실각 {cliff.slopeAngle.toFixed(0)}°
        </Label>
      )}
    </>
  );
}
