import { useId, type CSSProperties } from "react";

import { HEARTBEAT_PATHS, type HeartbeatShape } from "@/data/heartbeatPaths";
import { COLOR } from "@/styles/tokens";

interface HeartbeatLineProps {
  shape?: HeartbeatShape;
  width?: number | string;
  /** 빼면 길의 원래 높이. */
  height?: number | string;
  /** 바탕선 색. */
  color?: string;
  /** 달리는 빛 색. */
  glowColor?: string;
  strokeWidth?: number;
  /** 빛이 한 번 훑는 데 걸리는 초. */
  duration?: number;
  /** 시작을 늦추는 초. 두 줄이 번갈아 뛰게 할 때 쓴다. */
  delay?: number;
  /** 바탕선 진하기. */
  opacity?: number;
  style?: CSSProperties;
}

/**
 * 심장박동 선. <img> 로는 바깥에서 stroke 를 못 건드려 길만 꺼내 인라인으로 그리고,
 * 짧은 dash 가 stroke-dashoffset 으로 훑고 지나간다.
 * 번짐은 CSS drop-shadow 대신 획에만 SVG filter 로 건다 — 요소 전체를 합성하면 스크롤이 버벅인다.
 */
export default function HeartbeatLine({
  shape = "large",
  width = "100%",
  height,
  color = COLOR.navy,
  glowColor = COLOR.blue,
  strokeWidth = 1.2,
  duration = 3.4,
  delay = 0,
  opacity = 0.55,
  style,
}: HeartbeatLineProps) {
  const path = HEARTBEAT_PATHS[shape];
  const blurId = `heartbeat-blur${useId().replace(/:/g, "")}`;
  const timing: CSSProperties = { animationDuration: `${duration}s`, animationDelay: `${delay}s` };

  // pathLength 를 100 으로 맞춰 어떤 모양이든 같은 dash 값을 쓴다.
  return (
    <svg
      // 길이 실제로 그려진 범위만 담는다. 여백이 남으면 그림이 한쪽으로 쏠린다.
      viewBox={`${path.x} ${path.y} ${path.w} ${path.h}`}
      preserveAspectRatio="none"
      width={width}
      height={height ?? path.h}
      style={{ display: "block", overflow: "visible", pointerEvents: "none", ...style }}
      aria-hidden="true"
    >
      <defs>
        <filter id={blurId} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      <path d={path.d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeOpacity={opacity} pathLength="100" />
      <path
        className="pulse-glow"
        d={path.d}
        fill="none"
        stroke={glowColor}
        strokeWidth={strokeWidth * 2.6}
        strokeLinecap="round"
        pathLength="100"
        filter={`url(#${blurId})`}
        style={timing}
      />
      <path
        className="pulse-light"
        d={path.d}
        fill="none"
        stroke={glowColor}
        strokeWidth={strokeWidth * 1.35}
        strokeLinecap="round"
        pathLength="100"
        style={timing}
      />
    </svg>
  );
}
