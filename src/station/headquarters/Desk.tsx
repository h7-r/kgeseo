import { useGLTF } from "@react-three/drei";
import type * as THREE from "three";

import GltfPartMeshes from "@/engine/GltfPartMeshes";
import { useToonGltfParts } from "@/engine/gltfModel";
import type { OutlineValues } from "@/engine/toon";
import { HEADQUARTERS_PALETTE } from "@/station/layout/dimensions";

const DESK_URL = "/models/desk.glb";
useGLTF.preload(DESK_URL);

/** 배율 1 에서 모델 중심 → 바닥 거리 */
const DESK_RAW_MINY = 0.6225;

interface DeskProps {
  /** [x, z] */
  pos?: [number, number];
  rot?: number;
  scale?: number;
  /** 바닥 높이 미세 조정 */
  lift?: number;
  /** 가로(x) 배율 */
  stretch?: number;
  /** 세로(z) 배율 */
  zStretch?: number;
  /** 높이(y) 배율 */
  yStretch?: number;
  color?: THREE.ColorRepresentation;
  outline?: OutlineValues | null;
}

/** 철제 책상 GLB. */
export default function Desk({
  pos = [0, 0],
  rot = 0,
  scale = 1,
  lift = 0,
  stretch = 1,
  zStretch = 1,
  yStretch = 1,
  color = HEADQUARTERS_PALETTE.struct,
  outline,
}: DeskProps) {
  const [x, z] = pos;
  const parts = useToonGltfParts(DESK_URL, color);
  // 밑면이 y=0 에 오게 올린다. 높이를 늘리면 바닥까지 거리도 같이 커진다.
  const y = DESK_RAW_MINY * scale * yStretch + lift;

  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={[scale * stretch, scale * yStretch, scale * zStretch]}>
      <GltfPartMeshes parts={parts} outline={outline} />
    </group>
  );
}
