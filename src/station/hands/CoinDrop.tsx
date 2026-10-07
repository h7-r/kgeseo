import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Vector3Tuple } from "three";

import { coinDroppedTime, type CoinKind } from "@/props/coinState";

interface CoinDropProps {
  kind: CoinKind;
  /** 바닥 자리 */
  position: Vector3Tuple;
  /** 바닥에서 띄우는 높이(보통 두께 절반) */
  lift?: number;
  /** 반환구 자리. 주면 거기서 앞 바닥으로 포물선을 그리며 떨어진다. */
  from?: Vector3Tuple | null;
  children?: ReactNode;
}

/**
 * 내려놓은 동전의 낙하·반동. 모서리로 떨어져 한 번 튕기고 눕는다.
 * 처음부터 바닥이던 동전(droppedTime 0)은 연출 없이 눕혀 둔다. 겨냥·판정과는 무관하다.
 */
export default function CoinDrop({ kind, position, lift = 0, from, children }: CoinDropProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [bx, by, bz] = position;
  const landY = by + lift;
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const t0 = coinDroppedTime(kind);
    const t = t0 ? (performance.now() - t0) / 1000 : 99;

    if (from) {
      const total = 0.72;
      const fall = 0.5;
      if (t >= total) {
        group.position.set(bx, landY, bz);
        group.rotation.z = 0;
        return;
      }
      let x: number;
      let y: number;
      let z: number;
      if (t < fall) {
        // 앞으로는 등속, 아래로는 가속 + 처음 살짝 튀어나오는 호
        const k = t / fall;
        x = from[0] + (bx - from[0]) * k;
        z = from[2] + (bz - from[2]) * k;
        y = from[1] + (landY - from[1]) * (k * k) + Math.sin(k * Math.PI) * 0.1;
      } else {
        const b = (t - fall) / (total - fall);
        x = bx;
        z = bz;
        y = landY + Math.sin(b * Math.PI) * 0.1 * (1 - b); // 바닥에서 한 번 튕김
      }
      group.position.set(x, y, z);
      const rk = Math.min(1, t / 0.58);
      const ease = 1 - Math.pow(1 - rk, 3);
      group.rotation.z = (1 - ease) * 1.4; // 구르며 눕는다
      return;
    }

    // 제자리에서 수직으로 떨어져 눕는다
    const total = 0.55;
    let dy = 0;
    let rz = 0;
    if (t < total) {
      const fall = 0.3;
      const height = 0.7;
      if (t < fall) {
        const k = t / fall;
        dy = height * (1 - k * k);
      } else {
        const b = (t - fall) / (total - fall);
        dy = Math.sin(b * Math.PI) * 0.12 * (1 - b);
      }
      dy = Math.max(0, dy);
      const rk = Math.min(1, t / 0.42);
      const ease = 1 - Math.pow(1 - rk, 3);
      rz = (1 - ease) * 1.35 - Math.sin(rk * Math.PI) * 0.14;
    }
    group.position.set(bx, landY + dy, bz);
    group.rotation.z = rz;
  });
  return (
    <group ref={groupRef} position={[bx, landY, bz]}>
      {children}
    </group>
  );
}
