import { useFrame } from "@react-three/fiber";

import { updateAim, updateAimGlow } from "./interaction";
import { trackViewer } from "./inventory";

/** 매 프레임 겨눈 물건을 고른다(마우스가 잠겨 있을 때만). 소지품을 꺼낼 자리도 여기서 받아 둔다 */
export default function InteractionLoop() {
  useFrame(({ camera }, delta) => {
    updateAim(camera, !!document.pointerLockElement);
    updateAimGlow(Math.min(delta, 0.1));
    trackViewer(camera);
  });
  return null;
}
