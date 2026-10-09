import { useEffect, useMemo, useRef } from "react";
import { Outlines } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { scaleColor } from "@/engine/color";
import { buildMergedBoxes, type BoxPiece } from "@/engine/geometry";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";
import { Interactable } from "@/lobby/AimTracker";
import { rattleHinge, computeRattleOffset, toggleHinge, useIsHingeOpen } from "@/props/hingeState";

import { EXIT_SIGN_ASPECT, makeExitSignTexture } from "./signTextures";

interface CorridorEndDoorProps {
  /** 복도 중앙 x */
  x?: number;
  /** 끝벽 z */
  z?: number;
  /** +1 이면 문이 +z(복도 안)를 향한다 */
  inward?: number;
  width?: number;
  height?: number;
  doorColor?: string;
  frameColor?: string;
  handleColor?: string;
  /** 문이 거의 검정이라 검은 선은 안 보인다 — 이 문만 선을 밝은 쪽으로 뒤집는다 */
  lineColor?: string;
  /** 문틀을 문짝보다 이만큼 밝게 — 두 면이 붙어 보이지 않게 */
  contrast?: number;
  casingWidth?: number;
  casingDepth?: number;
  doorThickness?: number;
  exitSign?: boolean;
  exitSignScale?: number;
  exitSignHeight?: number;
  exitSignRimColor?: string;
  exitSignColor?: string;
  brightness?: number;
  /** 주면 [E] 로 여닫는 문이 된다 */
  openId?: string | null;
  /** 거짓이면 덜컹거리기만 한다(전기 잠금) */
  canOpen?: boolean;
  /** 유도등도 전기가 와야 켜진다 — 깜깜한 구간에서 초록 표지만 빛나면 거짓말이다 */
  exitSignLit?: boolean;
  outline?: OutlineValues | null;
}

/**
 * 복도 끝 비상계단 철문. 복도가 아무 표시 없이 벽으로 끝나면 미완성으로 보인다 —
 * 닫힌 문 하나가 「저 너머에도 공간이 있다」는 인상을 만든다.
 */
export default function CorridorEndDoor({
  x = -25.5,
  z = -30,
  inward = 1,
  width = 3.4,
  height = 6.6,
  doorColor = "#1c1d21",
  frameColor = "#1e2024",
  handleColor = "#cdd9e5",
  lineColor = "#41484b",
  contrast = 1.35,
  casingWidth = 0.75,
  casingDepth = 0.15,
  doorThickness = 0.05,
  exitSign = true,
  exitSignScale = 0.62,
  exitSignHeight = 0.65,
  exitSignRimColor = "#31333b",
  exitSignColor = "#3f9e63",
  brightness = 1,
  openId = null,
  canOpen = false,
  exitSignLit = true,
  outline,
}: CorridorEndDoorProps) {
  const signTexture = makeExitSignTexture(exitSignColor, outline?.outlineColor ?? "#131314");
  const isDoorOpen = useIsHingeOpen(openId ?? "");
  const doorRef = useRef<THREE.Group>(null);
  const doorAngle = useRef(0);
  const aimPoint = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const door = doorRef.current;
    if (!door) return;
    // 경첩은 왼쪽(−x) 세로변. +각이면 문 끝(+x)이 −z(계단실) 쪽으로 돈다.
    const target = isDoorOpen ? (inward * (100 * Math.PI)) / 180 : 0;
    doorAngle.current += (target - doorAngle.current) * Math.min(1, dt * 5);
    door.rotation.y = doorAngle.current + computeRattleOffset(openId) * 0.05 * inward;
  });

  const zf = z + inward * 0.1;
  const door = scaleColor(doorColor, brightness);
  const frame = scaleColor(frameColor, brightness * contrast);
  const line = scaleColor(lineColor, brightness);
  const outlineNode = outline?.outline ? <Outlines thickness={outline.outlineWidth} color={line} /> : null;

  const bar = 0.05;
  const front = zf + inward * (doorThickness / 2 + 0.07); // 문짝 표면보다 살짝 앞
  const doorW = width - 0.12;
  const doorH = height - 0.1;

  // 벽면이 z 에 수직이라 폭 = x, 깊이 = z 방향이다
  const parts = useMemo(() => {
    const casing = buildMergedBoxes([
      ...[-1, 1].map((sx): BoxPiece => ({
        size: [casingWidth, height + casingWidth, casingDepth],
        position: [sx * (width / 2 + casingWidth / 2), (height + casingWidth) / 2, zf + inward * 0.1],
      })),
      {
        size: [width + casingWidth * 2, casingWidth, casingDepth],
        position: [0, height + casingWidth / 2, zf + inward * 0.1],
      },
    ]);
    const gaps = buildMergedBoxes([
      { size: [doorW, bar, bar], position: [0, height / 2 + doorH / 2, front] },
      { size: [doorW, bar, bar], position: [0, height / 2 - doorH / 2, front] },
      ...[-1, 1].map((sx): BoxPiece => ({
        size: [bar, doorH, bar],
        position: [sx * (doorW / 2), height / 2, front],
      })),
    ]);
    const iw = doorW - 0.7;
    const ih = doorH - 0.9;
    const cy = height / 2 + 0.08;
    const panels = buildMergedBoxes([
      { size: [iw, bar * 0.7, bar * 0.7], position: [0, cy + ih / 2, front] },
      { size: [iw, bar * 0.7, bar * 0.7], position: [0, cy - ih / 2, front] },
      ...[-1, 1].map((sx): BoxPiece => ({
        size: [bar * 0.7, ih, bar * 0.7],
        position: [sx * (iw / 2), cy, front],
      })),
    ]);
    const hinges = buildMergedBoxes(
      [0.78, 0.5, 0.2].map((t): BoxPiece => ({
        size: [0.22, 0.5, 0.1],
        position: [-doorW / 2 + 0.02, 0.4 + t * (doorH - 0.6), zf + inward * (doorThickness / 2 + 0.04)],
      })),
    );
    return { casing, gaps, panels, hinges };
  }, [width, height, casingWidth, casingDepth, doorThickness, zf, inward, front, doorW, doorH, bar]);

  useEffect(
    () => () => {
      for (const g of Object.values(parts)) g?.dispose();
    },
    [parts],
  );

  return (
    <group>
      <mesh geometry={parts.casing ?? undefined} position={[x, 0, 0]} castShadow>
        <meshToonMaterial color={frame} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>

      {/* 개구부 안쪽면 — 문선과 문짝 사이의 깊이 */}
      <mesh position={[x, height / 2, zf - inward * 0.02]}>
        <boxGeometry args={[width + 0.04, height + 0.04, 0.3]} />
        <meshToonMaterial color={scaleColor(frameColor, brightness * 0.55)} gradientMap={TOON_GRADIENT} />
      </mesh>

      {/* 경첩 자리를 원점으로 도는 문짝 묶음. 부품은 그만큼 되돌려 넣어 보이는 자리는 그대로다. */}
      <group ref={doorRef} position={[x - doorW / 2, 0, zf]}>
        <mesh position={[doorW / 2, height / 2, inward * 0.06]} castShadow receiveShadow>
          <boxGeometry args={[doorW, doorH, doorThickness]} />
          <meshToonMaterial color={door} gradientMap={TOON_GRADIENT} />
          {outlineNode}
        </mesh>
        <mesh geometry={parts.gaps ?? undefined} position={[doorW / 2, 0, -zf]}>
          <meshToonMaterial color={line} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh geometry={parts.panels ?? undefined} position={[doorW / 2, 0, -zf]}>
          <meshToonMaterial color={line} gradientMap={TOON_GRADIENT} />
        </mesh>
        {/* 킥플레이트 */}
        <mesh position={[doorW / 2, 0.62, inward * (doorThickness / 2 + 0.05)]} castShadow>
          <boxGeometry args={[doorW - 0.16, 0.85, 0.05]} />
          <meshToonMaterial color={scaleColor(doorColor, brightness * 2.1)} gradientMap={TOON_GRADIENT} />
          {outlineNode}
        </mesh>
        {/* 손잡이 — 뒷판 + 레버 */}
        <mesh position={[doorW / 2 + width / 2 - 0.5, height * 0.45, inward * (doorThickness / 2 + 0.05)]}>
          <boxGeometry args={[0.34, 0.62, 0.05]} />
          <meshToonMaterial color={scaleColor(lineColor, brightness * 0.9)} gradientMap={TOON_GRADIENT} />
        </mesh>
        <mesh position={[doorW / 2 + width / 2 - 0.5, height * 0.45, inward * 0.22]} castShadow>
          <boxGeometry args={[0.62, 0.13, 0.13]} />
          <meshToonMaterial color={scaleColor(handleColor, brightness)} gradientMap={TOON_GRADIENT} />
          {outlineNode}
        </mesh>
      </group>

      {/* 경첩은 문틀 쪽에 남는다 */}
      <mesh geometry={parts.hinges ?? undefined} position={[x, 0, 0]} castShadow>
        <meshToonMaterial color={scaleColor(lineColor, brightness * 0.85)} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>

      {/* 계단실은 안 만든다. 어두운 틈 + 비상등 빛 한 점이면 저 너머가 읽힌다.
          문턱 바로 안쪽이어야 한다 — 더 깊으면 리빌 판에 가려 아무것도 안 비친다. */}
      {openId && (
        <pointLight
          position={[x, height * 0.55, zf - inward * 0.35]}
          color="#9fd9b0"
          intensity={isDoorOpen ? 14 : 0}
          distance={11}
          decay={2}
        />
      )}

      {openId && (
        <Interactable
          id={openId}
          radius={1.6}
          reach={7}
          position={() => {
            const doorGroup = doorRef.current;
            if (!doorGroup) return null;
            aimPoint.set(doorW / 2 + width / 2 - 0.5, height * 0.45, inward * 0.2);
            doorGroup.localToWorld(aimPoint);
            return [aimPoint.x, aimPoint.y, aimPoint.z];
          }}
          label={isDoorOpen ? "[E] 문 닫기" : canOpen ? "[E] 비상문 열기" : "[E] 잠김 — 전기 잠금"}
          run={() => (canOpen ? toggleHinge(openId) : rattleHinge(openId))}
        />
      )}

      {exitSign && (
        <group position={[x, height + casingWidth + exitSignHeight, zf + inward * 0.12]}>
          {/* 케이스는 표지판 뒤에 — 상자 두께가 중심 기준이라 앞으로 튀어나와 표지를 덮기 쉽다 */}
          <mesh position={[0, 0, -inward * 0.13]}>
            <boxGeometry args={[width * exitSignScale + 0.12, width * exitSignScale * EXIT_SIGN_ASPECT + 0.12, 0.16]} />
            <meshToonMaterial color={scaleColor(exitSignRimColor, brightness)} gradientMap={TOON_GRADIENT} />
          </mesh>
          <mesh position={[0, 0, inward * 0.02]} rotation={[0, inward > 0 ? 0 : Math.PI, 0]}>
            <planeGeometry args={[width * exitSignScale, width * exitSignScale * EXIT_SIGN_ASPECT]} />
            <meshBasicMaterial
              map={signTexture}
              color={exitSignLit ? "#ffffff" : "#23262a"}
              toneMapped={false}
              fog={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
