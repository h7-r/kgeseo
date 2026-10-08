import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { firstMeshGeometry } from "./gltfModel";

const FEDORA_URL = "/models/fedora.glb";
useGLTF.preload(FEDORA_URL);

interface FedoraProps {
  /** [x, z] */
  pos?: [number, number];
  y?: number;
  rot?: number;
  /** 자빠진 정도(x 축) */
  tilt?: number;
  /** 챙 지름(유닛). 1.0 ≈ 30cm */
  size?: number;
  color?: THREE.ColorRepresentation;
  outline?: OutlineValues | null;
}

/**
 * 중절모. 모델은 챙 테두리를 수평으로 바로잡고 챙 지름 1.0 으로 정규화해 두었다.
 * 매끈한 곡면이라 툰 음영만으로는 뭉개져, 주름선(40°)이 챙 끝·모자띠·꼭대기 자국을 그려 줘야 중절모로 읽힌다.
 */
export default function Fedora({
  pos = [0, 0],
  y = 0,
  rot = 0,
  tilt = 0,
  size = 1,
  color = "#5C422A",
  outline,
}: FedoraProps) {
  const { scene } = useGLTF(FEDORA_URL);
  const geometry = useMemo(() => firstMeshGeometry(scene) ?? undefined, [scene]);

  // 바깥 = 향하는 방향, 안쪽 = 자빠진 정도. 한 그룹에 두 회전을 같이 주면 축이 섞여 예측이 안 된다.
  return (
    <group position={[pos[0], y, pos[1]]} rotation={[0, rot, 0]}>
      <group rotation={[tilt, 0, 0]} scale={size}>
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
          <ToonOutline geometry={geometry} outline={outline} />
        </mesh>
      </group>
    </group>
  );
}
