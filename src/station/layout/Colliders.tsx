import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { PLAYER_RADIUS } from "@/engine/movement/constants";
import { getPushOffset } from "@/props/vendingPushState";

import { dynamicColliders, STATIC_COLLIDERS, type ColliderBox } from "./collision";

// 충돌 박스를 등록·표시하는 컴포넌트. 박스 목록과 막힘 판정은 collision.ts 에 있다.

interface AutoColliderProps {
  /** 물건마다 달라야 한다(같으면 서로 덮어쓴다). */
  name: string;
  enabled?: boolean;
  /** 실제 크기의 몇 배로 막을지. 낮출수록 헐렁하다. */
  margin?: number;
  /** 이보다 낮은 물건은 막지 않는다(발끝에 걸리는 느낌이 난다). */
  minHeight?: number;
  /** 이 값이 바뀌면 크기를 다시 잰다(Leva 값들을 넣는다). */
  remeasureKey?: string;
  children?: ReactNode;
}

/**
 * 그려진 물체를 Box3 로 재서 충돌 박스로 등록한다. 손으로 크기를 적으면 Leva 로 옮길 때마다 어긋난다.
 * 위치를 건드리지 않는 빈 group 이라 화면은 그대로다.
 */
export function AutoCollider({
  name,
  enabled = true,
  margin = 0.9,
  minHeight = 0.8,
  remeasureKey,
  children,
}: AutoColliderProps) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let triesLeft = 30; // 0.5초 간격으로 최대 15초

    // GLB 는 내려받은 뒤에야 자식으로 붙고, 그리기 전에는 월드 행렬이 원점이다.
    // 행렬을 직접 갱신하고 제대로 된 크기가 나올 때까지 다시 잰다.
    const measure = () => {
      const g = ref.current;
      if (!g) return false;
      g.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(g);
      if (b.isEmpty() || !isFinite(b.min.x)) return false;
      const height = b.max.y - b.min.y;
      const width = b.max.x - b.min.x;
      const depth = b.max.z - b.min.z;
      if (width < 0.05 || depth < 0.05) return false; // 아직 모델이 안 붙었다
      if (height < minHeight) return true; // 납작한 물건 — 안 막고 끝낸다
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      dynamicColliders.set(name, {
        minX: cx - (width / 2) * margin,
        maxX: cx + (width / 2) * margin,
        minZ: cz - (depth / 2) * margin,
        maxZ: cz + (depth / 2) * margin,
        // 손에 든 물건이 책상 위를 지나가려면 높이가 있어야 한다. 없으면 책상이 천장까지 솟은 벽이 된다.
        minY: b.min.y,
        maxY: b.max.y,
      });
      return true;
    };

    const attempt = () => {
      if (measure() || --triesLeft <= 0) return;
      timer = setTimeout(attempt, 500);
    };
    timer = setTimeout(attempt, 100); // 첫 그리기가 끝난 뒤에 시작한다

    return () => {
      clearTimeout(timer);
      dynamicColliders.delete(name);
    };
  }, [name, enabled, margin, minHeight, remeasureKey]);

  return <group ref={ref}>{children}</group>;
}

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
export function VendingMachineCollider({
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
    const d = getPushOffset();
    b.minZ = box.minZ + d;
    b.maxZ = box.maxZ + d;
  });
  return null;
}

interface ColliderDebugViewProps {
  visible?: boolean;
  height?: number;
}

/**
 * 막고 있는 영역을 빨간 상자로 그린다. isBlockedForPlayer() 가 플레이어 반지름을 더하므로 같은 만큼 부풀려야
 * 화면이 실제로 못 들어가는 범위와 맞는다.
 */
export function ColliderDebugView({ visible = false, height = 4 }: ColliderDebugViewProps) {
  const [boxes, setBoxes] = useState<ColliderBox[]>([]);
  useEffect(() => {
    if (!visible) return;
    const refresh = () => setBoxes([...STATIC_COLLIDERS, ...dynamicColliders.values()].map((c) => ({ ...c })));
    refresh();
    const id = setInterval(refresh, 500); // 물건을 옮기면 따라오게
    return () => clearInterval(id);
  }, [visible]);
  if (!visible) return null;
  return (
    <group>
      {boxes.map((c, i) => {
        const w = c.maxX - c.minX + PLAYER_RADIUS * 2;
        const d = c.maxZ - c.minZ + PLAYER_RADIUS * 2;
        return (
          <mesh key={i} position={[(c.minX + c.maxX) / 2, height / 2, (c.minZ + c.maxZ) / 2]}>
            <boxGeometry args={[w, height, d]} />
            <meshBasicMaterial color="#ff3b30" wireframe transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}
