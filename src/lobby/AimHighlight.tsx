/**
 * 겨냥한 물건을 글자 없이 알려 준다 — 살짝 커지고 스스로 빛난다.
 * 발광은 이미 걸린 Bloom 이 번지게 해 외곽이 물든 것처럼 보이므로 외곽선 메시가 따로 필요 없다.
 */
import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vector3Tuple } from "three";

import { aimStore } from "./interactions";

const glowColor = new THREE.Color();

type EmissiveMaterial = THREE.Material & { emissive?: THREE.Color };

interface AimHighlightProps {
  /** 한 물건에 겨냥 지점이 여럿이면(선의 두 끝) 배열로 준다 — 어느 쪽을 봐도 같이 밝아진다. */
  id: string | readonly string[];
  /** 확대 기준점. 물건들이 절대 좌표로 그려져 그냥 scale 하면 원점 기준으로 커져 방 밖으로 날아간다. */
  anchor: () => Vector3Tuple | null | undefined;
  color?: THREE.ColorRepresentation;
  /** 넓은 면(벽 부착함)은 0.45 면 통째로 크림색으로 뜬다 — 부르는 쪽에서 0.15~0.2 를 준다. */
  strength?: number;
  grow?: number;
  children?: ReactNode;
}

export function AimHighlight({
  id,
  anchor,
  color = "#fffee7",
  strength = 0.45,
  grow = 0.08,
  children,
}: AimHighlightProps) {
  const groupRef = useRef<THREE.Group>(null);
  const amount = useRef(0);
  const previous = useRef(0);
  const originalEmissive = useRef(new WeakMap<THREE.Material, THREE.Color>());

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const aimed = aimStore.get();
    const isAimed = typeof id === "string" ? aimed === id : aimed !== null && id.includes(aimed);
    const goal = isAimed ? 1 : 0;
    // 지수 감쇠 — 프레임 수와 상관없이 같은 속도로 붙는다
    amount.current += (goal - amount.current) * (1 - Math.exp(-delta * 14));
    const level = amount.current;

    // 기준점 p 중심으로 키우려면 월드 = k·자식 + p·(1−k)
    const k = 1 + grow * level;
    const p = anchor();
    if (p) {
      group.scale.setScalar(k);
      group.position.set(p[0] * (1 - k), p[1] * (1 - k), p[2] * (1 - k));
    }

    // 꺼져 있고 이미 껐으면 훑지 않는다(대부분의 프레임이 여기서 끝난다)
    if (level < 0.002 && previous.current < 0.002) return;
    previous.current = level;
    glowColor.set(color).multiplyScalar(level * strength);

    // 원래 발광에 더한다. 덮어쓰면 강조가 꺼질 때 스탠드 전구처럼 스스로 빛나던 부품이 영영 꺼진다.
    const apply = (material: EmissiveMaterial) => {
      if (!material.emissive) return;
      let original = originalEmissive.current.get(material);
      if (!original) {
        original = material.emissive.clone();
        originalEmissive.current.set(material, original);
      }
      material.emissive.copy(original).add(glowColor);
    };
    group.traverse((node) => {
      const material = (node as THREE.Mesh).material as EmissiveMaterial | EmissiveMaterial[] | undefined;
      if (!material) return;
      if (Array.isArray(material)) material.forEach(apply);
      else apply(material);
    });
  });

  return <group ref={groupRef}>{children}</group>;
}
