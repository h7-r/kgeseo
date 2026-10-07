import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import type { OutlineValues } from "@/engine/toon";
import { vendingMachineStore, type VendingId } from "@/props/vendingMachineState";

interface DispensedCanProps {
  vendingId?: VendingId;
  canRadius: number;
  canHeight: number;
  /** 배출구 안쪽 바닥판 윗면 */
  trayFloor: number;
  z: number;
  labelTexture: THREE.Texture;
  /** 캔 색 밝기(0~1) */
  tone: number;
  outline?: OutlineValues | null;
}

const DROP_TOTAL = 0.62;
const FALL_SECONDS = 0.3;

/**
 * 배출구로 떨어져 한 번 튕기고 옆으로 눕는 캔.
 * 눕혀야 라벨 옆면이 앞을 봐서 뚜껑이 아니라 음료 색이 보인다.
 */
export default function DispensedCan({
  vendingId,
  canRadius,
  canHeight,
  trayFloor,
  z,
  labelTexture,
  tone,
  outline,
}: DispensedCanProps) {
  const ref = useRef<THREE.Group>(null);
  const lyingY = trayFloor + canRadius;
  const standingY = trayFloor + canHeight / 2;
  useFrame(() => {
    const can = ref.current;
    if (!can) return;
    const droppedAt = vendingId ? vendingMachineStore.get(vendingId).canDroppedAt : 0;
    const t = droppedAt ? (performance.now() - droppedAt) / 1000 : 99;
    if (t >= DROP_TOTAL) {
      can.position.y = lyingY;
      can.rotation.z = Math.PI / 2;
      return;
    }
    const startY = standingY + 0.5;
    let y: number;
    if (t < FALL_SECONDS) {
      const k = t / FALL_SECONDS;
      y = startY - (startY - lyingY) * (k * k); // 중력처럼 가속
    } else {
      const b = (t - FALL_SECONDS) / (DROP_TOTAL - FALL_SECONDS);
      y = lyingY + Math.sin(b * Math.PI) * 0.14 * (1 - b); // 한 번 튕긴다
    }
    const rk = Math.min(1, t / 0.45);
    const eased = 1 - Math.pow(1 - rk, 3);
    can.position.y = Math.max(lyingY, y);
    can.rotation.z = eased * (Math.PI / 2) + Math.sin(rk * Math.PI) * 0.18; // 눕는 회전 + 오버슈트
  });
  return (
    <group ref={ref} position={[0, standingY, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[canRadius, canRadius, canHeight, 16]} />
        <CanMaterials labelTexture={labelTexture} tone={tone} />
        <ToonOutline outline={outline} />
      </mesh>
    </group>
  );
}

/** 캔 원통 재질 세 장 — 옆면 라벨 · 위 은색 뚜껑 · 아래 어두운 바닥. */
export function CanMaterials({ labelTexture, tone }: { labelTexture: THREE.Texture; tone: number }) {
  return (
    <>
      <meshBasicMaterial
        attach="material-0"
        map={labelTexture}
        toneMapped={false}
        color={new THREE.Color(tone, tone, tone)}
      />
      <meshBasicMaterial
        attach="material-1"
        color={new THREE.Color(0.7 * tone, 0.72 * tone, 0.75 * tone)}
        toneMapped={false}
      />
      <meshBasicMaterial
        attach="material-2"
        color={new THREE.Color(0.22 * tone, 0.23 * tone, 0.26 * tone)}
        toneMapped={false}
      />
    </>
  );
}
