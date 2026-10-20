import { Component, Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { runWhenIdle } from "@/lib/idle";
import { usePrefersReducedMotion } from "@/lib/motionPreference";

// three.js 는 수백 KB 라 첫 화면을 늦추지 않도록 장면 코드를 따로 떼어 받는다.
const SCENES = {
  deepSpace: lazy(() => import("./DeepSpaceScene")),
  river: lazy(() => import("./river/RiverScene")),
};

type SceneName = keyof typeof SCENES;

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
  scene: SceneName;
  /** 페이지 load 뒤 한가할 때 붙인다. 장식이 본문 이미지 로딩과 경쟁하지 않게 한다. */
  deferred?: boolean;
  /** false 면 화면 안에 있어도 렌더 루프를 세운다. */
  active?: boolean;
  style?: CSSProperties;
  /**
   * 장면이 화면을 맡을 수 있는지 알린다 — 첫 장을 그릴 준비가 끝나면 true,
   * 문맥을 잃거나·오류로 꺼지거나·떼어지거나·그리기가 멈추면 false. 바깥은 false 면 원래 바탕으로 돌아가야 한다.
   */
  onReadyChange?: (ready: boolean) => void;
}

/**
 * 3D 장면을 안전하게 얹는 칸. 화면 근처에 올 때만 붙이고, 밖으로 나가면 렌더를 세운다.
 * WebGL 이 없거나 장면이 죽으면 조용히 비워 둔다 — 뒤의 배경이 그대로 보인다.
 */
export default function SceneSlot({ scene, deferred = false, active = true, style, onReadyChange }: SceneSlotProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
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
          setIsVisible(entry.isIntersecting);
          // 한 번 붙이면 계속 둔다. 오갈 때마다 WebGL 문맥을 새로 만드는 쪽이 훨씬 비싸다.
          if (entry.isIntersecting) setIsMounted(true);
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

  // 오류 경계가 장면을 껐으면 바깥에 알린다 — 빈 캔버스를 배경인 줄 알고 구역 바탕을 걷어 둔 채로 두지 않게.
  useEffect(() => {
    if (failed) onReadyChange?.(false);
  }, [failed, onReadyChange]);

  const Scene = SCENES[scene];

  return (
    <div ref={slotRef} aria-hidden="true" style={{ ...slotStyle, ...style }}>
      {isMounted && !failed && (
        <SceneErrorBoundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <Scene visible={isVisible && active} reducedMotion={reducedMotion} onReadyChange={onReadyChange} />
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
