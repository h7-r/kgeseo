import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import * as THREE from "three";

import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

import { FLICKER_PATTERNS, type FlickerPattern } from "./flickerPatterns";
import { fluorescentPanelTexture } from "./textures";

interface CorridorLightProps {
  x?: number;
  y?: number;
  z?: number;
  /** Y축 회전(라디안) */
  rotation?: number;
  width?: number;
  length?: number;
  /** 확산판 자체 색(빛 색과 별개) */
  panelColor?: string;
  /** 판 색에 곱하는 배수. toneMapped 가 꺼져 있어 1을 넘으면 순백으로 타올라 등처럼 보인다. */
  glow?: number;
  /** 바닥을 비추는 빛 색 */
  color?: string;
  intensity?: number;
  /** 스포트라이트 퍼짐 각(라디안) */
  angle?: number;
  penumbra?: number;
  distance?: number;
  frameColor?: string;
  grime?: number;
  stainSeed?: number;
  flicker?: boolean;
  pattern?: FlickerPattern;
  /** 세기가 0 → 양수로 바뀔 때 이만큼(초) 늦게 켜진다. 등마다 다르게 주면 불이 한 칸씩 흘러가듯 켜진다. */
  turnOnDelay?: number;
  outline?: OutlineValues | null;
}

/**
 * 천장 형광 패널등. 점광원 하나는 흐린 얼룩만 남기고 빛의 출처가 화면에 없다 —
 * 눈에 보이는 하얀 판을 달고 빛은 아래쪽 원뿔(스포트라이트)로만 내린다.
 */
export default function CorridorLight({
  x = 0,
  y = 8,
  z = 0,
  rotation = 0,
  width = 1.1,
  length = 4,
  panelColor = "#fffce7",
  glow = 1.1,
  color = "#8fa6c4",
  intensity = 14.5,
  angle = 0.51,
  penumbra = 0.18,
  distance = 16,
  frameColor = "#38383b",
  grime = 0.8,
  stainSeed = 1,
  flicker = true,
  pattern = FLICKER_PATTERNS[0],
  turnOnDelay = 0,
  outline,
}: CorridorLightProps) {
  const panelRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const texture = fluorescentPanelTexture(stainSeed, grime);
  const baseColor = useMemo(() => new THREE.Color(panelColor), [panelColor]);

  // target 이 씬에 실제로 들어가 있지 않으면 스포트라이트는 조용히 원점을 비춘다.
  useEffect(() => {
    if (lightRef.current && targetRef.current) lightRef.current.target = targetRef.current;
  }, []);

  // 켜짐 시각은 React 상태로 두지 않는다 — 등이 켜질 때마다 복도 전체가 다시 그려진다.
  const turnOnAt = useRef(-1);
  const previousIntensity = useRef(intensity);
  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (previousIntensity.current <= 0 && intensity > 0) turnOnAt.current = now + turnOnDelay;
    if (intensity <= 0) turnOnAt.current = -1;
    previousIntensity.current = intensity;
    const isWaiting = turnOnAt.current > 0 && now < turnOnAt.current;
    let brightness = isWaiting ? 0 : 1;
    if (flicker && !isWaiting) {
      const t = clock.elapsedTime + pattern.offset;
      const p = t % pattern.period;
      for (const [start, duration] of pattern.offs) {
        if (p >= start && p < start + duration) {
          brightness = 0;
          break;
        }
        const d = p - (start + duration);
        if (d > 0 && d < 0.16) brightness = Math.min(brightness, 0.45 + Math.random() * 0.55);
      }
    }
    if (panelRef.current) panelRef.current.color.copy(baseColor).multiplyScalar((0.08 + brightness * 0.92) * glow);
    if (lightRef.current) lightRef.current.intensity = intensity * brightness;
  });

  const outlineNode = outline?.outline ? (
    <Outlines thickness={outline.outlineWidth} color={outline.outlineColor} />
  ) : null;

  const rims: [number, number, number, [number, number, number]][] = [
    [0, -0.035, length / 2, [width + 0.1, 0.06, 0.05]],
    [0, -0.035, -length / 2, [width + 0.1, 0.06, 0.05]],
    [width / 2, -0.035, 0, [0.05, 0.06, length + 0.1]],
    [-width / 2, -0.035, 0, [0.05, 0.06, length + 0.1]],
  ];

  return (
    <group position={[x, y, z]} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[width + 0.18, 0.16, length + 0.18]} />
        <meshToonMaterial color={frameColor} gradientMap={TOON_GRADIENT} />
        {outlineNode}
      </mesh>
      {/* 빛을 안 받고 제 색을 내서 스스로 빛나 보인다 */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <planeGeometry args={[width, length]} />
        <meshBasicMaterial ref={panelRef} map={texture} toneMapped={false} fog={false} />
      </mesh>

      {/* 밝은 판과 틀 사이를 끊는 어두운 테 — 밝은 면이 배경으로 번져 보이지 않는다 */}
      {rims.map(([bx, by, bz, size], i) => (
        <mesh key={`rim${i}`} position={[bx, by, bz]}>
          <boxGeometry args={size} />
          <meshToonMaterial color={outline?.outlineColor ?? "#131314"} gradientMap={TOON_GRADIENT} />
        </mesh>
      ))}
      {/* 점광원은 천장에도 동그란 얼룩을 남긴다. 스포트라이트는 아래 원뿔만 비춘다. */}
      <spotLight
        ref={lightRef}
        position={[0, -0.25, 0]}
        angle={angle}
        penumbra={penumbra}
        distance={distance}
        decay={1.7}
        intensity={intensity}
        color={color}
        castShadow={false}
      />
      <object3D ref={targetRef} position={[0, -8, 0]} />
    </group>
  );
}
