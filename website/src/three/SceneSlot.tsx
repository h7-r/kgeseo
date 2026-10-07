import { Component, Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { runWhenIdle } from "@/lib/idle";
import { usePrefersReducedMotion } from "@/lib/motionPreference";

// three.js 는 수백 KB 라 첫 화면을 늦추지 않도록 장면 코드를 따로 떼어 받는다.
const SCENES = {
  orbit: lazy(() => import("./OrbitScene")),
  deepSpace: lazy(() => import("./DeepSpaceScene")),
};

export type SceneName = keyof typeof SCENES;

let webglSupported: boolean | null = null;

/** WebGL 문맥을 만들 수 있는지 한 번만 확인하고 답을 기억한다. */
function isWebglSupported(): boolean {
  if (webglSupported !== null) return webglSupported;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    webglSupported = Boolean(context);
    // 확인용 문맥을 바로 돌려준다. 안 그러면 GC 전까지 GPU 문맥 하나가 더 살아 있다(브라우저 한도 16개).
    context?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglSupported = false;
  }
  return webglSupported;
}

const slotStyle: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

interface SceneSlotProps {
  scene?: SceneName;
  /** 페이지 load 뒤 한가할 때 붙인다. 장식이 본문 이미지 로딩과 경쟁하지 않게 한다. */
  deferred?: boolean;
  /** false 면 화면 안에 있어도 렌더 루프를 세운다. */
  active?: boolean;
  style?: CSSProperties;
}

/**
 * 3D 장면을 안전하게 얹는 칸. 화면 근처에 올 때만 붙이고, 밖으로 나가면 렌더를 세운다.
 * WebGL 이 없거나 장면이 죽으면 조용히 비워 둔다 — 뒤의 배경이 그대로 보인다.
 */
export default function SceneSlot({ scene = "orbit", deferred = false, active = true, style }: SceneSlotProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return;
    const slot = slotRef.current;
    if (!slot) return;

    let cancelIdle: (() => void) | null = null;
    let disconnect: (() => void) | null = null;

    const observe = () => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          // WebGL 확인은 문맥을 하나 만들었다 버리는 비싼 일이라 실제로 붙일 때까지 미룬다.
          if (entry.isIntersecting && !isWebglSupported()) {
            setFailed(true);
            return;
          }
          setVisible(entry.isIntersecting);
          // 한 번 붙이면 계속 둔다. 오갈 때마다 WebGL 문맥을 새로 만드는 쪽이 훨씬 비싸다.
          if (entry.isIntersecting) setMounted(true);
        },
        // 화면에 닿기 한참 전에 붙여야 스크롤해 내려올 때 뒤늦게 툭 나타나지 않는다.
        { rootMargin: "1200px" },
      );
      observer.observe(slot);
      disconnect = () => observer.disconnect();
    };

    const startWhenIdle = () => {
      cancelIdle = runWhenIdle(observe, 2500, 900);
    };

    if (!deferred) observe();
    else if (document.readyState === "complete") startWhenIdle();
    else window.addEventListener("load", startWhenIdle, { once: true });

    return () => {
      disconnect?.();
      cancelIdle?.();
      window.removeEventListener("load", startWhenIdle);
    };
  }, [deferred, failed]);

  const Scene = SCENES[scene];

  return (
    <div ref={slotRef} aria-hidden="true" style={{ ...slotStyle, ...style }}>
      {mounted && !failed && (
        <SceneErrorBoundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <Scene visible={visible && active} reducedMotion={reducedMotion} />
          </Suspense>
        </SceneErrorBoundary>
      )}
    </div>
  );
}

interface SceneErrorBoundaryProps {
  onError: () => void;
  children: ReactNode;
}

interface SceneErrorBoundaryState {
  hasError: boolean;
}

// 낡은 기기에서 WebGL 이 도중에 죽어도 장식 하나 때문에 페이지가 하얘지면 안 된다.
// 자식의 렌더 오류는 클래스 컴포넌트로만 잡을 수 있다.
class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  override state: SceneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.warn("[SceneSlot] 장면을 끕니다:", error instanceof Error ? error.message : error);
    this.props.onError();
  }

  override render() {
    return this.state.hasError ? null : this.props.children;
  }
}
