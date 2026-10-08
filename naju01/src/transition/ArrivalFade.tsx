import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";

import { ARRIVAL_FADE_MS } from "./useArrivalFade";

interface FirstFrameSignalProps {
  onFirstFrame: () => void;
  /** 몇 장째에 알릴지 */
  frames?: number;
}

/**
 * Canvas 안에 둔다. R3F 는 Canvas children 을 Suspense 하나로 묶으므로, 이 컴포넌트의 useFrame 이 돈다는 건
 * GLB·지형이 다 준비됐다는 뜻이다. useFrame 은 그 프레임을 그리기 전에 돌아서 두 장째에 알린다.
 */
export function FirstFrameSignal({ onFirstFrame, frames = 2 }: FirstFrameSignalProps) {
  const frameCount = useRef(0);
  const hasSignaled = useRef(false);
  useFrame(() => {
    if (hasSignaled.current) return;
    frameCount.current += 1;
    if (frameCount.current < frames) return;
    hasSignaled.current = true;
    onFirstFrame();
  });
  return null;
}

interface ArrivalCoverProps {
  revealed: boolean;
}

/** Canvas 밖에 둔다. 검게 덮고 있다가 revealed 면 걷히고, 다 걷히면 DOM 에서 빠진다(투명한 판이 클릭을 먹지 않게) */
export function ArrivalCover({ revealed }: ArrivalCoverProps) {
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    if (!revealed || isDone) return undefined;
    const timer = setTimeout(() => setIsDone(true), ARRIVAL_FADE_MS + 60);
    return () => clearTimeout(timer);
  }, [revealed, isDone]);

  if (isDone) return null;
  return <div aria-hidden style={{ ...coverStyle, opacity: revealed ? 0 : 1 }} />;
}

const coverStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  // 계기판·시점 단추(20)보다 위. Leva 패널은 덮지 않아도 된다.
  zIndex: 40,
  background: "#000",
  transition: `opacity ${ARRIVAL_FADE_MS}ms ease-out`,
  pointerEvents: "none",
};
