import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

import { isPointerActive } from "@/engine/input/virtualLock";
import { isCameraFocused } from "../scene/cameraFocus";
import { updateAim, updateAimGlow } from "./interaction";
import { trackViewer } from "./inventory";
import { clearSpentItems } from "./spentItems";

/** 매 프레임 겨눈 물건을 고른다(마우스가 잠겨 있고 화면 고정이 아닐 때만). 소지품을 꺼낼 자리도 여기서 받아 둔다 */
export default function InteractionLoop() {
  const spentTimer = useRef(0);
  useFrame(({ camera }, delta) => {
    // 쓸 일 끝난 물건 치우기 — 0.5초마다면 충분하다
    spentTimer.current -= delta;
    if (spentTimer.current <= 0) {
      spentTimer.current = 0.5;
      clearSpentItems();
    }
    updateAim(camera, isPointerActive() && !isCameraFocused());
    updateAimGlow(Math.min(delta, 0.1));
    trackViewer(camera);
  });
  return null;
}
