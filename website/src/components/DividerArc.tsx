import { useId } from "react";

import { COLOR } from "@/styles/tokens";

// 위아래 끝을 같은 x 에 두고 가운데만 왼쪽으로 부풀려야 기울지 않은 활이 된다.
const END_X = 104;
const BELLY_X = 18;
// 3차 베지에 t=0.5 지점의 x. 호가 실제로 차지하는 가로 범위의 한가운데를 맞추는 데 쓴다.
const ACTUAL_BELLY_X = (END_X + BELLY_X * 6) / 8;
const ARC_CENTER_X = (END_X + ACTUAL_BELLY_X) / 2;

/** 가장 밝은 자리(6할쯤)의 색. */
const ARC_HIGHLIGHT = "#f4f4f5";

interface DividerArcProps {
  /** 두 덩이 사이 가운데 x(px). 호가 차지하는 범위의 한가운데가 여기에 온다. */
  centerX: number;
  top: number;
  height: number;
}

/**
 * 왼쪽 덩이와 오른쪽 덩이를 가르는 긴 호. 다른 장식이 전부 곡선이라 직선 대신 쓴다.
 * 굵기는 그라디언트로 못 바꾸니 같은 길을 번지는 획과 또렷한 획으로 두 번 그린다.
 */
export default function DividerArc({ centerX, top, height }: DividerArcProps) {
  const id = useId().replace(/:/g, "");
  const gradientId = `arc-gradient${id}`;
  const blurId = `arc-blur${id}`;

  // 조절점을 위아래 대칭으로 두어 배가 정확히 한가운데에서 가장 많이 나온다.
  const d = `M ${END_X} 0 C ${BELLY_X} ${height * 0.26} ${BELLY_X} ${height * 0.74} ${END_X} ${height}`;

  return (
    <svg
      aria-hidden="true"
      width={END_X + 6}
      height={height}
      viewBox={`0 0 ${END_X + 6} ${height}`}
      style={{
        position: "absolute",
        left: `${centerX - ARC_CENTER_X}px`,
        top: `${top}px`,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLOR.arc} stopOpacity="0" />
          <stop offset="14%" stopColor={COLOR.arc} stopOpacity="0.8" />
          <stop offset="55%" stopColor={ARC_HIGHLIGHT} stopOpacity="1" />
          <stop offset="86%" stopColor={COLOR.arc} stopOpacity="0.9" />
          <stop offset="100%" stopColor={COLOR.arc} stopOpacity="0" />
        </linearGradient>
        <filter id={blurId} x="-200%" y="-10%" width="500%" height="120%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <path
        d={d}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="4.4"
        strokeLinecap="round"
        opacity="0.8"
        filter={`url(#${blurId})`}
      />
      <path d={d} fill="none" stroke={`url(#${gradientId})`} strokeWidth="1.8" strokeLinecap="round" />

      {/* 호를 따라 내려가는 빛. 한 겹이면 흐릿하고 굵게만 하면 바탕선과 색이 따로 놀아 두 겹을 겹친다. */}
      <path
        className="arc-glow"
        d={d}
        fill="none"
        stroke="#aab6d3"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength="100"
        filter={`url(#${blurId})`}
        style={{ opacity: 0.85 }}
      />
      <path
        className="arc-glow"
        d={d}
        fill="none"
        stroke="#f2f8ff"
        strokeWidth="1.6"
        strokeLinecap="round"
        pathLength="100"
      />
    </svg>
  );
}
