import type { ReactNode } from "react";

import { TOON_GRADIENT } from "@/engine/toon";

import type { PresentedControls } from "../../app/presentation";
import { MESH_NAMES } from "../../plan/meshNames";
import type { ConnectorRamp } from "../../terrain/connectorRamp";
import type { PathFallback, PathShapes } from "../usePathLayers";
import type { GroundShading } from "../useNajuControls";
import type { Terrain } from "../useTerrainLayers";
import GroundMaterial from "./GroundMaterial";
import Label from "./Label";
import { planPoint } from "./planPoint";
import SlopeSegment from "./SlopeSegment";

interface PathLayerProps {
  controls: PresentedControls;
  measuredPaths: Terrain["measuredPaths"];
  pathShapes: PathShapes;
  fallback: PathFallback;
  isBakedTerrainOn: boolean;
  ramp: ConnectorRamp | null;
  shading: GroundShading;
  shade: (color: string) => string;
  outline: ReactNode;
}

/** 통로와 연결로 — 길디테일을 끄면 노란 리본. 걷는 폭은 도면 그대로, 갓길·비탈은 그 바깥으로만 낸다. */
export default function PathLayer({
  controls: T,
  measuredPaths,
  pathShapes,
  fallback,
  isBakedTerrainOn,
  ramp,
  shading,
  shade,
  outline,
}: PathLayerProps) {
  const { pathSegments, embankment } = fallback;
  return (
    <>
      {pathShapes ? (
        <>
          {/* 새 땅에는 길이 파여 있어 리본을 얹으면 z 싸움이 난다 */}
          {!isBakedTerrainOn &&
            pathShapes.built.map((v, i) => (
              <group key={`path-${measuredPaths[i].code}`}>
                {v.slope && (
                  <mesh name={MESH_NAMES.slope} geometry={v.slope} receiveShadow castShadow>
                    <GroundMaterial
                      shading={shading}
                      brightness={T.brightness}
                      doubleSided
                      grain
                      grainEnabled={T.groundGrain > 0}
                    />
                  </mesh>
                )}
                {/* 단면 — 양면이면 아래에서 올려다볼 때 빛 못 받는 밑면이 세로 검은 띠로 나온다 */}
                <mesh name={MESH_NAMES.path} geometry={v.path} receiveShadow>
                  <GroundMaterial
                    shading={shading}
                    brightness={T.brightness}
                    grain="path"
                    grainEnabled={T.groundGrain > 0}
                  />
                </mesh>
              </group>
            ))}
        </>
      ) : (
        <>
          {embankment && (
            <mesh name={MESH_NAMES.pathEmbankment} geometry={embankment} receiveShadow castShadow>
              <meshToonMaterial color={shade(T.cliffColor)} gradientMap={TOON_GRADIENT} />
            </mesh>
          )}
          {pathSegments.map((s) => (
            <SlopeSegment key={s.key} a={s.a} b={s.b} width={s.width} color={shade(T.pathColor)} outline={outline} />
          ))}
        </>
      )}

      {T.showLabels &&
        measuredPaths.map((t) => {
          const middle = t.points[Math.floor(t.points.length / 2)];
          const y = t.startElevation + t.rise * 0.5;
          const isOff = Math.abs(t.planarLength - t.plannedLength) > 0.6;
          return (
            <Label key={t.code} position={planPoint(middle[0], middle[1], y + 2)} color={isOff ? "#FFC9C2" : "#F6E7B8"}>
              {t.code} {t.name} · {t.route} · w{t.width} · {t.planarLength.toFixed(1)} m · {t.slope.toFixed(1)}°
            </Label>
          );
        })}

      {/* 연결로 — 그림과 걷는 높이가 같은 함수를 본다 */}
      {ramp?.geometry && (
        <mesh name={MESH_NAMES.connectorRamp} geometry={ramp.geometry} receiveShadow castShadow>
          <GroundMaterial
            shading={shading}
            brightness={T.brightness}
            doubleSided
            grain
            grainEnabled={T.groundGrain > 0}
          />
        </mesh>
      )}
    </>
  );
}
