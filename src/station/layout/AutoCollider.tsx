import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";

import { dynamicColliders } from "./collision";

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
export default function AutoCollider({
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
