import { useEffect, useMemo } from "react";
import { Outlines } from "@react-three/drei";

import { scaleColor } from "@/engine/color";
import { mergeBoxes, type MergeBox } from "@/engine/geometry";
import { makeRandom } from "@/engine/random";
import { TOON_GRADIENT } from "@/engine/toon";

import { wornDoorTexture } from "./textures";

interface CorridorSideDoorProps {
  x?: number;
  z?: number;
  /** +1 이면 문이 +x(복도 안)를 향한다 */
  facing?: number;
  width?: number;
  height?: number;
  doorColor?: string;
  revealColor?: string;
  gapColor?: string;
  panelLineColor?: string;
  hingeColor?: string;
  knobColor?: string;
  lockPlateColor?: string;
  keyholeColor?: string;
  thresholdColor?: string;
  boardColor?: string;
  nailColor?: string;
  /** 문틀이 벽에서 나온 정도 */
  frameProtrusion?: number;
  /** 문짝이 문틀 면보다 안쪽으로 들어간 정도 */
  inset?: number;
  /** 문턱이 복도로 나온 정도 */
  thresholdProtrusion?: number;
  showOutline?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  doorThickness?: number;
  grime?: number;
  /** 널빤지로 막아 둔 문 */
  boarded?: boolean;
  brightness?: number;
  seed?: number;
}

/**
 * 복도 옆 사무실 문(닫힌 채). 바깥벽이 통짜 평면이라 깊은 알코브 대신 얕게 박힌 플러시 문으로 짠다.
 * 재질이 같고 움직이지 않는 부속은 미리 합쳐 드로우콜을 줄인다.
 */
export default function CorridorSideDoor({
  x = -31,
  z = 0,
  facing = 1,
  width = 3.0,
  height = 6.4,
  doorColor = "#8b8880",
  revealColor = "#3a3831",
  gapColor = "#5a6064",
  panelLineColor = "#6a7076",
  hingeColor = "#6b4a2f",
  knobColor = "#8d8378",
  lockPlateColor = "#5a5148",
  keyholeColor = "#0c0e11",
  thresholdColor = "#3f443f",
  boardColor = "#6a5b45",
  nailColor = "#8a8078",
  frameProtrusion = 0.06,
  inset = 0.03,
  thresholdProtrusion = 0.06,
  showOutline = true,
  outlineColor = "#131314",
  outlineWidth = 5,
  doorThickness = 0.09,
  grime = 1,
  boarded = false,
  brightness = 1,
  seed = 1,
}: CorridorSideDoorProps) {
  const texture = wornDoorTexture(seed, grime);
  const door = scaleColor(doorColor, brightness);
  const gap = scaleColor(gapColor, brightness);
  const panelLine = scaleColor(panelLineColor, brightness);
  const outlineNode = showOutline ? <Outlines thickness={outlineWidth} color={outlineColor} /> : null;

  const d = facing;
  // 문짝은 개구부를 거의 꽉 채운다(둘레 틈만 살짝)
  const doorW = width - 0.06;
  const doorH = height - 0.06;
  const frameDepth = Math.max(0, Math.min(frameProtrusion, 0.25));
  const frameGeoDepth = Math.max(0.02, frameDepth); // 0 이면 지오가 퇴화한다
  const insetDepth = Math.max(0, Math.min(inset, 0.1));
  const thresholdDepth = Math.max(0, Math.min(thresholdProtrusion, 0.4));
  // 문 앞면은 벽보다 앞, 문틀 면보다 안
  const doorFace = d * Math.max(0.01, frameDepth - 0.02 - insetDepth);
  const doorX = doorFace - d * (doorThickness / 2); // 문짝 중심 — 부속들이 이 값 기준
  const front = doorX + d * (doorThickness / 2 + 0.02); // 문 앞면 위에 살짝 뜬 선·패널
  const bar = 0.05;

  const parts = useMemo(() => {
    const gaps = mergeBoxes([
      { size: [bar, bar, doorW], position: [front, height / 2 + doorH / 2, 0] },
      { size: [bar, bar, doorW], position: [front, height / 2 - doorH / 2, 0] },
      ...[-1, 1].map((sz): MergeBox => ({
        size: [bar, doorH, bar],
        position: [front, height / 2, sz * (doorW / 2)],
      })),
    ]);

    const pw = doorW - 0.7;
    const panels = mergeBoxes(
      [
        { cy: height * 0.62, ph: height * 0.42 },
        { cy: height * 0.25, ph: height * 0.26 },
      ].flatMap((pn): MergeBox[] => [
        { size: [bar * 0.9, bar * 0.9, pw], position: [front, pn.cy + pn.ph / 2, 0] },
        { size: [bar * 0.9, bar * 0.9, pw], position: [front, pn.cy - pn.ph / 2, 0] },
        ...[-1, 1].map((sz): MergeBox => ({
          size: [bar * 0.9, pn.ph, bar * 0.9],
          position: [front, pn.cy, sz * (pw / 2)],
        })),
      ]),
    );

    const hinges = mergeBoxes(
      [0.78, 0.5, 0.2].map((t): MergeBox => ({
        size: [0.1, 0.5, 0.22],
        position: [doorX + d * (doorThickness / 2 + 0.02), 0.4 + t * (doorH - 0.6), -doorW / 2 + 0.02],
      })),
    );

    // 널빤지 그룹 안 좌표 기준
    const nails = mergeBoxes(
      [-1, 1].flatMap((sz) =>
        [-0.14, 0.14].map((oy): MergeBox => ({
          size: [0.05, 0.09, 0.09],
          position: [d * 0.09, oy, sz * (width * 0.42)],
        })),
      ),
    );

    // 벽면(x=0)에서 얇게 나온 문틀(위 + 좌우)
    const frameThickness = 0.16;
    const frame = mergeBoxes([
      {
        size: [frameGeoDepth, frameThickness, width + 2 * frameThickness],
        position: [d * (frameGeoDepth / 2), height + frameThickness / 2 - 0.03, 0],
      },
      ...[-1, 1].map((sz): MergeBox => ({
        size: [frameGeoDepth, height + frameThickness, frameThickness],
        position: [d * (frameGeoDepth / 2), height / 2, sz * (width / 2 + frameThickness / 2)],
      })),
    ]);

    return { gaps, panels, hinges, nails, frame };
  }, [width, height, doorThickness, frameGeoDepth, d, front, doorX, doorW, doorH, bar]);

  useEffect(
    () => () => {
      for (const g of Object.values(parts)) g?.dispose();
    },
    [parts],
  );

  const rnd = makeRandom(seed * 97 + 5);
  const knobX = doorX + d * (doorThickness / 2 + 0.02);

  return (
    <group position={[x, 0, z]}>
      <mesh geometry={parts.frame ?? undefined} castShadow>
        <meshToonMaterial color={scaleColor(revealColor, brightness * 1.1)} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>

      <mesh position={[doorX, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[doorThickness, doorH, doorW]} />
        <meshToonMaterial color={door} map={texture} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>

      <mesh geometry={parts.gaps ?? undefined}>
        <meshToonMaterial color={gap} gradientMap={TOON_GRADIENT} />
      </mesh>

      <mesh geometry={parts.panels ?? undefined}>
        <meshToonMaterial color={panelLine} gradientMap={TOON_GRADIENT} />
      </mesh>

      <mesh geometry={parts.hinges ?? undefined} castShadow>
        <meshToonMaterial color={scaleColor(hingeColor, brightness)} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>

      {/* 손잡이 — 뒷판 + 노브 + 열쇠구멍(색이 달라 합치지 않는다) */}
      <mesh position={[knobX, height * 0.44, doorW / 2 - 0.45]}>
        <boxGeometry args={[0.05, 0.7, 0.34]} />
        <meshToonMaterial color={scaleColor(lockPlateColor, brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      <mesh
        position={[doorX + d * (doorThickness / 2 + 0.13), height * 0.44, doorW / 2 - 0.45]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.17, 0.2, 0.26, 12]} />
        <meshToonMaterial color={scaleColor(knobColor, brightness)} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>
      <mesh position={[doorX + d * (doorThickness / 2 + 0.03), height * 0.36, doorW / 2 - 0.45]}>
        <boxGeometry args={[0.03, 0.13, 0.08]} />
        <meshToonMaterial color={keyholeColor} gradientMap={TOON_GRADIENT} />
      </mesh>

      {boarded &&
        [0.28, -0.2].map((tilt, i) => {
          const y = height * (i === 0 ? 0.55 : 0.3);
          return (
            <group key={`bd${i}`} position={[front + d * 0.06, y, 0]} rotation={[tilt, 0, 0]}>
              <mesh castShadow>
                <boxGeometry args={[0.14, 0.62, width + 0.5]} />
                <meshToonMaterial
                  color={scaleColor(boardColor, brightness * (0.85 + rnd() * 0.3))}
                  map={wornDoorTexture(seed + 70 + i, grime)}
                  gradientMap={TOON_GRADIENT}
                />
                {outlineNode}
              </mesh>
              <mesh geometry={parts.nails ?? undefined}>
                <meshToonMaterial color={scaleColor(nailColor, brightness)} gradientMap={TOON_GRADIENT} />
              </mesh>
            </group>
          );
        })}

      {/* 개구부 밑, 벽에서 복도로 얕게 나온 문턱 */}
      <mesh position={[d * (thresholdDepth / 2), 0.06, 0]} receiveShadow>
        <boxGeometry args={[Math.max(0.04, thresholdDepth), 0.12, width + 0.12]} />
        <meshToonMaterial color={scaleColor(thresholdColor, brightness)} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>
    </group>
  );
}
