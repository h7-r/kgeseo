import { useGLTF } from "@react-three/drei";

import GltfPartMeshes from "@/engine/GltfPartMeshes";
import { useToonGltfParts } from "@/engine/gltfModel";
import type { OutlineValues } from "@/engine/toon";

// 책상 위 컴퓨터 한 벌 — 모니터·키보드·마우스.
// 모니터만 있는 모델(좌표계는 pc.glb 와 같다).
useGLTF.preload("/models/pc_monitor.glb");
// 가로폭 1.0 · 밑면 y 0 · 중앙 정렬 · 낮은 앞턱이 +Z 로 정규화한 모델.
useGLTF.preload("/models/keyboard.glb");
// 길이 1.0 · 밑면 y 0 · 중앙 정렬 · 휠·케이블 쪽이 +Z 로 정규화한 모델.
useGLTF.preload("/models/mouse.glb");

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
 * 책상 위 모니터. 키보드·마우스는 들었다 놓을 수 있게 따로 그린다(Keyboard·Mouse) —
 * 모니터 기준 좌표면 옮긴 뒤엔 기준이 사라진다.
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
  const parts = useToonGltfParts("/models/pc_monitor.glb", color);
  return (
    // 크기는 안쪽 그룹만 바꾼다. 바깥은 Y축 회전뿐이라 회전축 높이와 상관없다.
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <group position={[0, y, 0]} scale={PC_SCALE * scale * sizeMul}>
        <GltfPartMeshes parts={parts} outline={outline} />
      </group>
    </group>
  );
}

interface KeyboardProps {
  /** [x, z] */
  pos?: [number, number];
  y?: number;
  rot?: number;
  /** 월드 유닛 가로폭(모델 폭이 1.0) */
  size?: number;
  /** 가로폭 대비 두께 배수 */
  thickness?: number;
  /** 가로폭 대비 깊이 배수 */
  depth?: number;
  color?: string;
  outline?: OutlineValues | null;
}

/** 들 수 있는 키보드. 스스로 월드 좌표를 가져야 내려놓은 뒤에도 자리가 남는다. */
export function Keyboard({
  pos = [0, 0],
  y = 0,
  rot = 0,
  size = 1.55,
  thickness = 0.5,
  depth = 0.83,
  color = "#2c2f34",
  outline,
}: KeyboardProps) {
  const [x, z] = pos;
  const parts = useToonGltfParts("/models/keyboard.glb", color);
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={[size, size * thickness, size * depth]}>
      <GltfPartMeshes parts={parts} outline={outline} />
    </group>
  );
}

interface MouseProps {
  /** [x, z] */
  pos?: [number, number];
  y?: number;
  rot?: number;
  /** 월드 유닛 길이(모델 길이가 1.0) */
  size?: number;
  color?: string;
  outline?: OutlineValues | null;
}

/** 들 수 있는 마우스. */
export function Mouse({ pos = [0, 0], y = 0, rot = 0, size = 0.37, color = "#2c2f34", outline }: MouseProps) {
  const [x, z] = pos;
  const parts = useToonGltfParts("/models/mouse.glb", color);
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={size}>
      <GltfPartMeshes parts={parts} outline={outline} />
    </group>
  );
}
