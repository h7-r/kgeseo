import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";

import type { GltfPart } from "./gltfModel";

interface GltfPartsProps {
  parts: GltfPart[];
  outline?: OutlineValues | null;
  /** 선을 두르지 않을 메시 이름(전구처럼 스스로 빛나는 부품) */
  outlineExclude?: string[];
  /** 작고 굴곡진 물건은 그림자맵 해상도가 모자라 제 표면에 섀도 아크네가 생긴다 — 그럴 땐 끈다. */
  receiveShadow?: boolean;
}

/** splitGltf 조각을 메시로 그리고 조각마다 외곽선·주름선을 붙인다. */
export default function GltfParts({ parts, outline, outlineExclude, receiveShadow = true }: GltfPartsProps) {
  return parts.map((part, i) => (
    <mesh
      key={i}
      geometry={part.geometry}
      material={part.material}
      position={part.position}
      quaternion={part.quaternion}
      scale={part.scale}
      castShadow
      receiveShadow={receiveShadow}
    >
      <ToonOutline geometry={part.geometry} outline={outlineExclude?.includes(part.name) ? null : outline} />
    </mesh>
  ));
}
