import { useEffect, useMemo } from "react";
import { Outlines, useGLTF } from "@react-three/drei";
import type * as THREE from "three";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Highlight } from "@/lobby/Highlight";
import { dentGeometry, stainGeometry } from "@/station/vertexNoise";

import { firstMeshGeometry } from "../firstMeshGeometry";
import CabinetDrawer from "./CabinetDrawer";
import { CAB_FZ, CAB_LINE_GEO, cabinetLineGeometry, type CabinetOpening } from "./cabinetGeometry";
import DrawerAimGlow from "./DrawerAimGlow";

const CABINET_URL = "/models/cabinet.glb";
useGLTF.preload(CABINET_URL);

const ORIGIN = (): THREE.Vector3Tuple => [0, 0, 0];

/** 겨냥하면 빛낼 서랍 한 칸 */
export interface CabinetAim {
  id: string;
  row: number;
  color?: THREE.ColorRepresentation;
  strength?: number;
}

interface CabinetProps {
  /** [x, z] */
  pos?: [number, number];
  baseY?: number;
  /** 0 = 서랍이 +Z 를 본다 */
  rot?: number;
  /** 4.3 ≈ 1.3m */
  height?: number;
  /** 얼룩·찌그러짐이 통째로 달라진다 */
  seed?: number;
  color?: THREE.ColorRepresentation;
  dentCount?: number;
  dentDepth?: number;
  stainCount?: number;
  stainStrength?: number;
  showLines?: boolean;
  lineColor?: THREE.ColorRepresentation;
  /** null 이면 전부 닫힘 */
  opening?: CabinetOpening | null;
  aim?: CabinetAim | null;
  drawerWear?: number;
  outline?: OutlineValues | null;
}

/**
 * 서류 캐비닛. 툰 단색으로 덮으면 GLB 의 녹·얼룩 텍스처를 버리게 되므로,
 * 찌그러짐은 정점을 밀어 넣어, 얼룩은 정점 색으로 만든다 — 시드만 바꿔 서로 다르게 낡힌다.
 */
export default function Cabinet({
  pos = [0, 0],
  baseY = 0,
  rot = 0,
  height = 4.3,
  seed = 7,
  color = "#4A4F56",
  dentCount = 4,
  dentDepth = 0.009,
  stainCount = 10,
  stainStrength = 1.0,
  showLines = true,
  lineColor = "#8A929C",
  opening = null,
  aim = null,
  drawerWear = 1,
  outline,
}: CabinetProps) {
  const [x, z] = pos;
  const { scene } = useGLTF(CABINET_URL);

  const geometry = useMemo(() => {
    const source = firstMeshGeometry(scene);
    if (!source) throw new Error("cabinet.glb 에 메시가 없습니다.");
    // 캐비닛마다 따로 찌그러지려면 제 지오를 가져야 한다.
    const clone = source.clone();
    dentGeometry(clone, seed, dentCount, dentDepth);
    stainGeometry(clone, seed, stainCount, stainStrength);
    return clone;
  }, [scene, seed, dentCount, dentDepth, stainCount, stainStrength]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const openRow = opening?.row;
  const openAmount = opening?.amount;
  const lineGeometry = useMemo(
    () =>
      openRow !== undefined && openAmount !== undefined
        ? cabinetLineGeometry({ row: openRow, amount: openAmount })
        : CAB_LINE_GEO,
    [openRow, openAmount],
  );
  useEffect(
    () => () => {
      if (lineGeometry !== CAB_LINE_GEO) lineGeometry.dispose();
    },
    [lineGeometry],
  );

  return (
    <group position={[x, baseY, z]} rotation={[0, rot, 0]} scale={height}>
      <mesh geometry={geometry} castShadow receiveShadow>
        {/* 얼룩 정점 색이 곱해지고, 철제 상자라 면마다 각지게 */}
        <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} vertexColors flatShading />
        {outline?.outline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />}
      </mesh>
      {opening && (
        // 서랍은 커지지 않는다 — 커지면 몸통 구멍에서 삐져나와 보인다.
        <Highlight id={aim?.id ?? ""} color={aim?.color} strength={aim?.strength} grow={0} anchor={ORIGIN}>
          <CabinetDrawer
            outline={outline}
            dentCount={dentCount}
            dentDepth={dentDepth}
            stainCount={stainCount}
            stainStrength={stainStrength}
            row={opening.row}
            amount={opening.amount}
            hasPapers={opening.hasPapers}
            wearScale={drawerWear}
            color={color}
            seed={seed}
          />
        </Highlight>
      )}
      {/* toneMapped=false 라 어두운 방에서도 지정한 색 그대로 보인다. */}
      {showLines && (
        <lineSegments geometry={lineGeometry}>
          <lineBasicMaterial color={lineColor} toneMapped={false} />
        </lineSegments>
      )}
      {/* 열린 칸은 위 Highlight 가 서랍 메시 전체를 밝히므로, 이 덧판은 닫힌 칸에만 쓴다. */}
      {aim && !(opening && opening.row === aim.row) && (
        <DrawerAimGlow id={aim.id} row={aim.row} z={CAB_FZ} color={aim.color} strength={aim.strength} />
      )}
    </group>
  );
}
