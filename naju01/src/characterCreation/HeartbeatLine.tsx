// 웹사이트의 심장박동 선을 생성 화면에서도 쓴다.
// 웹사이트 컴포넌트는 그 앱의 전역 CSS 애니메이션에 기대므로 길 데이터만 같은 파일에서 가져오고
// 움직임은 HEARTBEAT_LINE_CSS 로 따로 건다. 선 모양을 고치면 두 화면이 같이 바뀐다.
import { useId, type CSSProperties } from "react";

import { HEARTBEAT_PATHS } from "../../../website/src/data/heartbeatPaths";

interface HeartbeatLineProps {
  shape?: keyof typeof HEARTBEAT_PATHS;
  width?: number | string;
  height?: number;
  /** 늘 흐리게 깔리는 바탕선 색 */
  color?: string;
  /** 훑고 지나가는 빛 색 */
  glow?: string;
  strokeWidth?: number;
  /** 한 번 훑는 데 걸리는 초 */
  period?: number;
  delay?: number;
  opacity?: number;
  style?: CSSProperties;
}

export default function HeartbeatLine({
  shape = "wide",
  width = "100%",
  height,
  color = "#5FB0C8",
  glow = "#BFF1FF",
  strokeWidth = 1.2,
  period = 3.6,
  delay = 0,
  opacity = 0.35,
  style,
}: HeartbeatLineProps) {
  const path = HEARTBEAT_PATHS[shape];
  const blurId = `heartbeat-line-blur${useId().replace(/:/g, "")}`;
  const animation: CSSProperties = { animationDuration: `${period}s`, animationDelay: `${delay}s` };
  return (
    <svg
      className="heartbeat-line"
      viewBox={`${path.x} ${path.y} ${path.w} ${path.h}`}
      preserveAspectRatio="none"
      width={width}
      height={height ?? path.h}
      style={{ display: "block", overflow: "visible", pointerEvents: "none", ...style }}
      aria-hidden="true"
    >
      <defs>
        <filter id={blurId} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <path
        d={path.d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        pathLength="100"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="heartbeat-line__glow-blur"
        d={path.d}
        fill="none"
        stroke={glow}
        strokeWidth={strokeWidth * 2.8}
        strokeLinecap="round"
        pathLength="100"
        filter={`url(#${blurId})`}
        vectorEffect="non-scaling-stroke"
        style={animation}
      />
      <path
        className="heartbeat-line__glow"
        d={path.d}
        fill="none"
        stroke={glow}
        strokeWidth={strokeWidth * 1.4}
        strokeLinecap="round"
        pathLength="100"
        vectorEffect="non-scaling-stroke"
        style={animation}
      />
    </svg>
  );
}
