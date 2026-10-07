import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { playerView } from "@/engine/playerView";
import { setFootSpot } from "@/props/hintPaperState";

const forward = new THREE.Vector3();

/**
 * 쪽지를 버릴 발 앞 자리를 적어 둔다. [E] 를 받는 App 은 Canvas 밖이라 카메라를 못 읽는다.
 * 0.1초에 한 번이면 걸으면서 버려도 반 걸음 차이도 안 난다.
 */
export default function FootSpotTracker() {
  const { camera } = useThree();
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < 0.1) return;
    elapsed.current = 0;
    camera.getWorldDirection(forward);
    // 원점은 사람이 선 자리. 카메라에서 재면 3인칭에서 쪽지가 등 뒤 벽 너머에 떨어져 영영 못 줍는다.
    // y 는 복도(0.01)·방(0) 둘 다 살짝 위로 띄운다.
    const body = playerView.ready ? playerView.eye : camera.position;
    setFootSpot([body.x + forward.x * 1.1, 0.05, body.z + forward.z * 1.1]);
  });
  return null;
}
