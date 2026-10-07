import { useGLTF } from "@react-three/drei";

import type { OutlineValues } from "@/engine/toon";

import { GltfParts, useToonParts } from "./gltfParts";

// pc.glb 를 z=0.1 에서 잘라 모니터만 남긴 모델. 좌표계를 안 건드려 예전 배치 값이 그대로 산다.
useGLTF.preload("/models/pc_monitor.glb");

/** 책상 위에 맞춘 기본 배율 */
const PC_SCALE = 1.6;

interface PcSetProps {
  /** [x, z] */
  pos?: [number, number];
  /** Y축 회전(라디안) */
  rot?: number;
  scale?: number;
  y?: number;
  /** 세트마다 따로 주는 배수. 모니터 크기 = PC_SCALE × scale × sizeMul */
  sizeMul?: number;
  color?: string;
  outline?: OutlineValues | null;
}

/**
 * 책상 위 모니터. 키보드·마우스는 들었다 놓을 수 있게 따로 떼어 냈다(Keyboard·Mouse) —
 * 여기 있으면 좌표가 모니터 기준이라 옮긴 뒤엔 기준이 사라진다.
 */
export default function PcSet({
  pos = [0, 0],
  rot = 0,
  scale = 1,
  y = 2.0,
  sizeMul = 1,
  color = "#3a3d42",
  outline,
}: PcSetProps) {
  const [x, z] = pos;
  const parts = useToonParts("/models/pc_monitor.glb", color);
  return (
    // 바깥 그룹은 크기를 안 건드린다. Y축 회전이라 회전축 높이와 상관없이 예전 배치가 그대로다.
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <group position={[0, y, 0]} scale={PC_SCALE * scale * sizeMul}>
        <GltfParts parts={parts} outline={outline} />
      </group>
    </group>
  );
}
