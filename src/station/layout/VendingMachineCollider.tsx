import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";

import { pushOffset } from "@/props/vendingPush";

import { dynamicColliders } from "./collision";

interface VendingMachineColliderProps {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** 라디안 */
  rotation: number;
  height: number;
  /** 밸브를 돌리면 z 로 밀리는 음료 자판기 — 매 프레임 밀린 만큼 박스를 옮긴다. */
  followsPush?: boolean;
  enabled?: boolean;
}

/**
 * 자판기 몸통 충돌. 배출구 덮개·간판 빛 같은 자식 때문에 Box3 로 재면 부풀어서, 이미 아는 크기·회전으로 만든다.
 * 밀리는 동안에도 박스가 따라와 몸이 자판기 속에 갇히지 않는다.
 */
export default function VendingMachineCollider({
  name,
  x,
  z,
  width,
  depth,
  rotation,
  height,
  followsPush = false,
  enabled = true,
}: VendingMachineColliderProps) {
  // ±90° 근처면 폭이 z 로 눕는다
  const isSideways = Math.abs(Math.sin(rotation)) > 0.5;
  const halfX = (isSideways ? depth : width) / 2;
  const halfZ = (isSideways ? width : depth) / 2;
  const box = useMemo(
    () => ({ minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ, minY: 0, maxY: height }),
    [x, z, halfX, halfZ, height],
  );
  useEffect(() => {
    if (!enabled) return undefined;
    dynamicColliders.set(name, { ...box });
    return () => {
      dynamicColliders.delete(name);
    };
  }, [name, enabled, box]);
  useFrame(() => {
    if (!enabled || !followsPush) return;
    const b = dynamicColliders.get(name);
    if (!b) return;
    const d = pushOffset();
    b.minZ = box.minZ + d;
    b.maxZ = box.maxZ + d;
  });
  return null;
}
