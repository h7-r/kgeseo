import { Component, type ReactNode } from "react";

import { showGraphicsFailure } from "../../../shared/graphicsFailure";

/**
 * 게임 화면이 그리다 죽으면(그래픽 연결이 끊긴 채 후처리가 값을 읽다 죽는 경우 등) 빈 화면 대신 안내를 낸다(미르 11/12 베타 보고).
 * 끊김이 먼저 잡혔으면 그 안내가 이미 떠 있다 — showGraphicsFailure 는 먼저 뜬 것을 그대로 둔다.
 */
export class GraphicsErrorBoundary extends Component<{ children: ReactNode }, { hasFailed: boolean }> {
  override state = { hasFailed: false };

  static getDerivedStateFromError() {
    return { hasFailed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("[화면] 게임 화면이 죽었다:", error);
    const isLost = [...document.querySelectorAll("canvas")].some((canvas) => {
      try {
        return canvas.getContext("webgl2")?.isContextLost() ?? false;
      } catch {
        return false;
      }
    });
    showGraphicsFailure(isLost ? "lost" : "crashed");
  }

  override render() {
    return this.state.hasFailed ? null : this.props.children;
  }
}
