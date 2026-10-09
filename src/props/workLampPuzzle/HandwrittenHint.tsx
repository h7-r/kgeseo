import { scaleColor } from "@/engine/color";

import { makeHandwritingTexture } from "./labelTextures";

interface HandwrittenHintProps {
  text: string;
  position: [number, number, number];
  rotation: [number, number, number];
  size?: number;
  color?: string;
  /** 밝기를 따라 어두워진다 — 어둠 속에서 혼자 뜨지 않게 */
  brightness?: number;
}

/** 먼저 지나간 누군가가 벽·판에 휘갈겨 둔 한 단어. 무엇을 봐야 하는지만 던진다. */
export default function HandwrittenHint({
  text,
  position,
  rotation,
  size = 0.9,
  color,
  brightness = 1,
}: HandwrittenHintProps) {
  const texture = makeHandwritingTexture(text, color);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[size, size / 2]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        color={scaleColor("#ffffff", Math.min(1, brightness))}
      />
    </mesh>
  );
}
