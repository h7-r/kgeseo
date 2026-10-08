import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { scaleColor } from "@/engine/color";
import { TOON_GRADIENT } from "@/engine/toon";

import { ATLAS_GRID } from "./atlasTextures";
import { CAR_HEIGHT } from "./dimensions";

export type LampState = { kind: "dead" } | { kind: "steady" } | { kind: "flicker"; phase: number; period: number };

// 버려진 열차는 전기가 불안정해야 한다. 대부분 켜져 있다가 가끔 한 번 발작하듯 깜빡이고,
// 발작 안에서는 처음엔 느리게 뒤로 갈수록 빠르게 끊긴다 — 안정기가 나간 형광등이 그렇게 죽는다.
// 쉬지 않고 규칙적으로 깜빡이면 고장이 아니라 장식으로 보인다.

/** 발작 구간의 [꺼짐 시작, 꺼짐 끝](초). 간격이 0.50 → 0.27 → 0.19 → 0.14 → 0.10 으로 좁아진다. */
const FIT_OFF_SPANS: readonly [number, number][] = [
  [0.0, 0.09],
  [0.59, 0.66],
  [0.93, 0.985],
  [1.175, 1.22],
  [1.36, 1.395],
  [1.495, 1.52],
];
const FIT_SECONDS = 1.75;

function flickerValue(time: number, phase: number, period: number): number {
  const u = (time + phase) % period;
  const fitStart = period - FIT_SECONDS;
  if (u < fitStart) return 1;
  const k = u - fitStart;
  for (const [a, b] of FIT_OFF_SPANS) {
    if (k >= a && k < b) return 0.05;
    // 다시 붙은 직후엔 잠깐 덜 밝다
    if (k >= b && k < b + 0.05) return 0.45;
  }
  return 1;
}

interface FluorescentLampProps {
  x: number;
  state: LampState;
  intensity: number;
  color: string;
  offColor: string;
  brightness: number;
  brokenMap: THREE.Texture;
  /** 깨진 커버 아틀라스에서 이 등이 쓸 칸 [열, 행] */
  uvCell: [number, number];
}

/** 천장 형광등 한 개. 깜빡임은 매 프레임 바뀌어 state 대신 three 객체를 직접 고친다. */
export default function FluorescentLamp({
  x,
  state,
  intensity,
  color,
  offColor,
  brightness,
  brokenMap,
  uvCell,
}: FluorescentLampProps) {
  const lightRef = useRef<THREE.PointLight>(null);
  const panelMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const onColor = useMemo(() => new THREE.Color(color), [color]);
  const off = useMemo(() => new THREE.Color(offColor), [offColor]);
  const [cellColumn, cellRow] = uvCell;
  const panelGeometry = useMemo(() => {
    const geometry = new THREE.BoxGeometry(6.4, 0.22, 1.7);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, uv.getX(i) / ATLAS_GRID + cellColumn / ATLAS_GRID, uv.getY(i) / ATLAS_GRID + cellRow / ATLAS_GRID);
    uv.needsUpdate = true;
    return geometry;
  }, [cellColumn, cellRow]);
  useEffect(() => () => panelGeometry.dispose(), [panelGeometry]);

  useFrame(({ clock }) => {
    const light = lightRef.current;
    const panelMaterial = panelMaterialRef.current;
    if (!light || !panelMaterial) return;
    const level =
      state.kind === "dead"
        ? 0
        : state.kind === "flicker"
          ? flickerValue(clock.elapsedTime, state.phase, state.period)
          : 1;
    light.intensity = intensity * level;
    // 빛만 꺼지고 판이 밝으면 가짜로 보인다.
    panelMaterial.color.copy(off).lerp(onColor, level);
  });

  return (
    <group position={[x, CAR_HEIGHT - 0.5, 0]}>
      {/* toneMapped=false 라 이 색이 그대로 찍히고 블룸이 번진다. */}
      <mesh geometry={panelGeometry}>
        <meshBasicMaterial ref={panelMaterialRef} map={brokenMap} color={color} toneMapped={false} />
      </mesh>
      {/* 등갓이 있어야 설치된 조명으로 보인다 */}
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[6.9, 0.26, 2.1]} />
        <meshToonMaterial color={scaleColor("#3c4149", brightness)} gradientMap={TOON_GRADIENT} />
      </mesh>
      {/* 등판 바로 밑이면 천장이 정면으로 맞아 툰 밝기 단이 동그란 얼룩으로 찍힌다. 내려 두면 바닥만 밝아진다. */}
      <pointLight ref={lightRef} position={[0, -1.8, 0]} intensity={intensity} distance={34} decay={2} color={color} />
    </group>
  );
}
