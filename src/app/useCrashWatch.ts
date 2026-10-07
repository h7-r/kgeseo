import { useCallback, useEffect, useState } from "react";
import type { RootState } from "@react-three/fiber";

import { crashLog } from "@/debug/crashLog";

/**
 * GPU 컨텍스트 손실과 장면 꺼짐을 화면 경고로 옮긴다.
 * 블랙박스는 그냥 객체라 React 가 바뀐 걸 모른다 — 1초에 한 번만 본다(매 프레임 보면 그게 더 비싸다).
 */
export function useCrashWatch() {
  const [isGpuLost, setIsGpuLost] = useState(false);
  const [isSceneEmptied, setIsSceneEmptied] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      // 이벤트를 놓쳤더라도 여기서 잡는다
      if (crashLog.contextLost) setIsGpuLost(true);
      if (crashLog.sceneEmptied) {
        setIsSceneEmptied(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleCanvasCreated = useCallback(({ gl }: RootState) => {
    const canvas = gl.domElement;
    // preventDefault 를 해야 브라우저가 「복구 가능」으로 처리한다.
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      setIsGpuLost(true);
    });
    // 복구 신호가 와도 경고를 지우지 않는다. R3F 는 텍스처·셰이더를 다시 올려 주지 않아 검은 화면만 남는다.
    canvas.addEventListener("webglcontextrestored", () => {
      crashLog.restoreAttempted = true;
    });
  }, []);

  return { isGpuLost, isSceneEmptied, handleCanvasCreated };
}
