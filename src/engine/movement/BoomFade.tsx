import { useEffect, useRef, type ReactNode } from "react";
import type * as THREE from "three";

import { boomState } from "./boom";

interface BoomFadeProps {
  children?: ReactNode;
}

/**
 * 붐이 짧아져 카메라가 캐릭터 머릿속에 들어가면 아바타를 감춘다. 상태 대신 칸 하나의 visible 만
 * useMovement 가 매 프레임 직접 바꾼다 — prop 으로 하면 벽 앞에서 왔다 갔다 할 때마다 Scene 이 다시 그려진다.
 * 1인칭에서는 절대 감추지 않는다(useMovement 가 거리를 99 로 되돌린다).
 */
export default function BoomFade({ children }: BoomFadeProps) {
  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    // 정리 함수가 돌 때쯤이면 ref 가 이미 null 일 수 있어 지금 붙잡아 둔다.
    const group = groupRef.current;
    if (!group) return;
    boomState.group = group;
    group.visible = boomState.visible;
    return () => {
      if (boomState.group === group) boomState.group = null;
    };
  }, []);
  return <group ref={groupRef}>{children}</group>;
}
