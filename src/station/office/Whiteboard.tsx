import { useMemo } from "react";
import { Outlines } from "@react-three/drei";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { BOARD_H, BOARD_LIFT, BOARD_W, whiteboardTexture } from "./whiteboardTexture";

/** 알루미늄 테두리 두께 */
const FRAME = 0.12;

interface WhiteboardProps {
  /** [x, z] */
  pos?: [number, number];
  rot?: number;
  y?: number;
  scale?: number;
  /** 알루미늄 테두리·다리 */
  cFrame?: string;
  outline?: OutlineValues | null;
}

/** 이동식 수사 화이트보드(세로 기둥 2 + 가로대 + 발). 판 그림은 캔버스로 그린다. */
export default function Whiteboard({
  pos = [0, 0],
  rot = 0,
  y = 0,
  scale = 1,
  cFrame = "#8A9099",
  outline,
}: WhiteboardProps) {
  const [x, z] = pos;
  const texture = useMemo(() => whiteboardTexture(), []);
  const bh = BOARD_H;
  const bw = BOARD_W;
  const cy = BOARD_LIFT + bh / 2; // 판 중심 높이
  const frame: [number, number, number, number][] = [
    [0, cy + bh / 2 + FRAME / 2, bw + FRAME * 2, FRAME], // 위
    [0, cy - bh / 2 - FRAME / 2, bw + FRAME * 2, FRAME], // 아래
    [-bw / 2 - FRAME / 2, cy, FRAME, bh], // 좌
    [bw / 2 + FRAME / 2, cy, FRAME, bh], // 우
  ];
  const outlines = outline?.outline && <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />;
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]} scale={scale}>
      {/* 판 뒷면(두께) */}
      <mesh position={[0, cy, -0.03]} castShadow receiveShadow>
        <boxGeometry args={[bw, bh, 0.06]} />
        <meshToonMaterial color="#D9D6CE" gradientMap={TOON_GRADIENT} />
        {outlines}
      </mesh>
      {/* 판 앞면 — 조명에 눌리지 않게 basic. color 로 살짝 눌러 흰 판이 폐역 톤에서 혼자 튀지 않게 한다. */}
      <mesh position={[0, cy, 0.001]}>
        <planeGeometry args={[bw, bh]} />
        <meshBasicMaterial map={texture} color="#B9B7B0" toneMapped={false} />
      </mesh>
      {frame.map(([fx, fy, fw, fh], i) => (
        <mesh key={i} position={[fx, fy, 0]} castShadow>
          <boxGeometry args={[fw, fh, 0.14]} />
          <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
          {outlines}
        </mesh>
      ))}
      {/* 펜 받침 */}
      <mesh position={[0, cy - bh / 2 - FRAME, 0.1]} castShadow>
        <boxGeometry args={[bw * 0.8, 0.08, 0.22]} />
        <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
        {outlines}
      </mesh>
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh position={[sx * (bw / 2 - 0.3), BOARD_LIFT / 2, 0]} castShadow>
            <boxGeometry args={[0.12, BOARD_LIFT + 0.2, 0.12]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {outlines}
          </mesh>
          <mesh position={[sx * (bw / 2 - 0.3), 0.06, 0]} castShadow>
            <boxGeometry args={[0.18, 0.12, 1.5]} />
            <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
            {outlines}
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[bw - 0.6, 0.1, 0.1]} />
        <meshToonMaterial color={cFrame} gradientMap={TOON_GRADIENT} />
        {outlines}
      </mesh>
    </group>
  );
}
