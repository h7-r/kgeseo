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
/** 봉우리 각이 약 15° 라 miter 길이는 선 굵기의 7~8배다. 한도를 그 위로 두어야 끝이 뾰족하게 남는다 */
const PEAK_MITER_LIMIT = 12;
/** 뾰족한 끝이 viewBox 밖으로 나가는 만큼(굵은 빛 선 기준) 위아래를 비워 둔다 — 조상 요소가 잘라도 봉우리가 남게 */
const peakOverhang = (strokeWidth: number) => (strokeWidth * 2.6 * PEAK_MITER_LIMIT) / 2;

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
  // 길의 범위에 봉우리 끝이 나갈 만큼을 더한다. 높이도 같은 비율로 키우고 그만큼 음수 여백으로 당겨 자리는 그대로다
  const pad = peakOverhang(strokeWidth);
  const paddedH = path.h + pad * 2;
  const givenH = height ?? path.h;
  const scale = paddedH / path.h;
  const svgHeight = typeof givenH === "number" ? givenH * scale : `calc(${givenH} * ${scale})`;
  // 음수 여백 — 문자열 높이("21px" · "100%")는 calc 안에서 음수 배율로(앞에 - 를 붙이면 CSS 가 버린다)
  const pullBack =
    typeof givenH === "number" ? `${(-givenH * (scale - 1)) / 2}px` : `calc(${givenH} * ${-(scale - 1) / 2})`;
  const blurId = `heartbeat-blur${useId().replace(/:/g, "")}`;
  const timing: CSSProperties = { animationDuration: `${duration}s`, animationDelay: `${delay}s` };

  // pathLength 를 100 으로 맞춰 어떤 모양이든 같은 dash 값을 쓴다.
  return (
    <svg
      // 길이 실제로 그려진 범위만 담는다. 여백이 남으면 그림이 한쪽으로 쏠린다.
      viewBox={`${path.x} ${path.y - pad} ${path.w} ${paddedH}`}
      preserveAspectRatio="none"
      width={width}
      height={svgHeight}
      style={{
        display: "block",
        overflow: "visible",
        pointerEvents: "none",
        marginTop: pullBack,
        marginBottom: pullBack,
        ...style,
      }}
      aria-hidden="true"
    >
      <defs>
        <filter id={blurId} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* 봉우리는 뾰족하게 — 기본 miterlimit 4 는 이 각(15° 안팎)에서 bevel 로 바뀌어 위아래가 깎인 것처럼 보였다(해랑 11/17) */}
      <path
        d={path.d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        strokeLinejoin="miter"
        strokeMiterlimit={PEAK_MITER_LIMIT}
        pathLength="100"
      />
      <path
        className="heartbeat-line__glow"
        d={path.d}
        fill="none"
        stroke={glowColor}
        strokeWidth={strokeWidth * 2.6}
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit={PEAK_MITER_LIMIT}
        pathLength="100"
        filter={`url(#${blurId})`}
        style={timing}
      />
      <path
        className="heartbeat-line__pulse"
        d={path.d}
        fill="none"
        stroke={glowColor}
        strokeWidth={strokeWidth * 1.35}
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit={PEAK_MITER_LIMIT}
        pathLength="100"
        style={timing}
      />
    </svg>
  );
}
