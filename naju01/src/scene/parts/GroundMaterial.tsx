import { useMemo } from "react";
import * as THREE from "three";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { groundGrainRef } from "../../terrain/groundGrain";
import type { GroundShading } from "../useNajuControls";

interface GroundMaterialProps {
  shading: GroundShading;
  brightness: number;
  /** 비탈 치마처럼 안팎이 다 보이는 면. 한쪽만 그리면 뒷면이 까맣게 뚫린다. */
  doubleSided?: boolean;
  /** 재질이 새로 생길 때마다 불리는 ref 콜백(물잔결처럼 셰이더를 끼울 때) */
  materialRef?: (material: THREE.Material | null) => void;
  /** true = 바닥 삼면결, "path" = 길 전용 결(진행 방향 결 + 바퀴 자국) */
  grain?: boolean | "path";
  grainEnabled?: boolean;
}

/**
 * 바닥 재질. 색은 꼭짓점 색에 구워 두었으므로 재질 색은 흰색(밝기만)이다.
 * 결은 바닥에만 건다 — 무리(나무·바위)까지 얹으면 잎마다 얼룩이 지고 값도 두 배다.
 */
export default function GroundMaterial({
  shading,
  brightness,
  doubleSided = false,
  materialRef,
  grain = false,
  grainEnabled = true,
}: GroundMaterialProps) {
  const color = scaleColor("#FFFFFF", brightness);
  const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  // 램버트↔툰으로 재질이 새로 생기면 ref 콜백이 다시 불려 새 재질에도 결이 걸린다.
  const grainRef = useMemo(
    () => (grain && grainEnabled ? groundGrainRef(null, { path: grain === "path" }) : null),
    [grain, grainEnabled],
  );
  const ref = materialRef ?? grainRef ?? undefined;
  return shading === "toon" ? (
    <meshToonMaterial ref={ref} vertexColors color={color} side={side} gradientMap={TOON_GRADIENT} />
  ) : (
    <meshLambertMaterial ref={ref} vertexColors color={color} side={side} />
  );
}
