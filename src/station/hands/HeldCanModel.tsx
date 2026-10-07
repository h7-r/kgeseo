import { useEffect, useMemo, type RefObject } from "react";
import * as THREE from "three";

import { ToonOutline } from "@/engine/outline";
import { TOON_GRADIENT, type OutlineValues } from "@/engine/toon";

interface HeldCanModelProps {
  color: string;
  isOpened: boolean;
  /** 따개 탭. 땄으면 HeldDrink 가 살짝 세운다 */
  tabRef: RefObject<THREE.Group | null>;
  outline?: OutlineValues | null;
}

/** 손에 든 음료 캔 — 라벨색 몸통 + 알루미늄 뚜껑 + 따개 탭. */
export default function HeldCanModel({ color, isOpened, tabRef, outline }: HeldCanModelProps) {
  // 컵과 같은 이유로 면을 28 로 늘렸다.
  const geometry = useMemo(() => new THREE.CylinderGeometry(0.09, 0.09, 0.3, 28, 1), []);
  // 뚜껑 테두리가 곧 캔의 윗 테라 선을 둘러야 몸통과 갈린다 — 그래서 지오를 따로 둔다.
  const lidGeometry = useMemo(() => new THREE.CircleGeometry(0.088, 28), []);
  useEffect(
    () => () => {
      geometry.dispose();
      lidGeometry.dispose();
    },
    [geometry, lidGeometry],
  );
  return (
    <group>
      <mesh geometry={geometry} castShadow>
        <meshToonMaterial color={color} gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={geometry} outline={outline} />
      </mesh>
      <mesh geometry={lidGeometry} position={[0, 0.152, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshToonMaterial color="#c9ccd0" gradientMap={TOON_GRADIENT} />
        <ToonOutline geometry={lidGeometry} outline={outline} />
      </mesh>
      {isOpened && (
        <mesh position={[0.032, 0.156, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.03, 12]} />
          <meshBasicMaterial color="#101216" toneMapped={false} />
        </mesh>
      )}
      <group position={[-0.02, 0.156, 0]} ref={tabRef}>
        <mesh>
          <boxGeometry args={[0.07, 0.008, 0.03]} />
          <meshBasicMaterial color="#b9bcc2" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
