import { useRef, useState } from "react";

import { formatNumber } from "../lib/format";
import type { Point } from "../preview/types";
import { MARGIN, niceScale, useElementWidth } from "./chartScale";

interface BarChartProps {
  label: string;
  bars: Point[];
  unit: string;
  xAxisLabel: string;
  /** 백분율처럼 위쪽 끝이 정해진 값 */
  fixedTop?: number;
  height?: number;
}

/** 글자 하나의 어림 폭(px, 12px 글꼴 한글 기준). 이름이 칸보다 길면 기울여 쓴다 */
const CHAR_WIDTH = 12;
/** 기울인 이름이 들어갈 아래 여백 */
const TILT_EXTRA = 44;

/** 막대. 값은 막대 위에 늘 적고, 마우스를 올린 막대는 진하게 한다. 이름이 칸보다 길면 기울여 겹치지 않게 한다. */
export default function BarChart({ label, bars, unit, xAxisLabel, fixedTop, height = 240 }: BarChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(boxRef);
  const [active, setActive] = useState<number | null>(null);

  const scale = niceScale(Math.max(...bars.map((bar) => bar.value)));
  const top = fixedTop ?? scale.top;
  const ticks = fixedTop ? [0, 0.25, 0.5, 0.75, 1].map((r) => r * fixedTop) : scale.ticks;
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const slot = innerWidth / Math.max(1, bars.length);
  const barWidth = Math.min(48, slot * 0.5);
  const longest = Math.max(0, ...bars.map((bar) => bar.label.length));
  const tilted = bars.length > 1 && longest * CHAR_WIDTH > slot - 8;
  const svgHeight = height + (tilted ? TILT_EXTRA : 0);
  const baseline = MARGIN.top + innerHeight;
  const y = (value: number) => baseline - (value / top) * innerHeight;
  const summary = `${label}. ${bars.map((bar) => `${bar.label} ${formatNumber(bar.value)}${unit}`).join(", ")}`;

  return (
    <div ref={boxRef} className="adm-chart">
      {width > 0 && (
        <svg width={width} height={svgHeight} role="img" aria-label={summary} className="adm-chart__svg">
          <text x={MARGIN.left - 8} y={14} className="adm-chart__axis-name" textAnchor="end">
            ({unit})
          </text>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} className="adm-chart__grid" />
              <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" className="adm-chart__tick">
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {bars.map((bar, i) => {
            const center = MARGIN.left + slot * (i + 0.5);
            return (
              <g key={bar.label} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}>
                <title>{`${bar.label} ${formatNumber(bar.value)}${unit}`}</title>
                <rect x={center - slot / 2} y={MARGIN.top} width={slot} height={innerHeight} fill="transparent" />
                <rect
                  x={center - barWidth / 2}
                  y={y(bar.value)}
                  width={barWidth}
                  height={Math.max(0, MARGIN.top + innerHeight - y(bar.value))}
                  rx={4}
                  className={active === i ? "adm-chart__bar is-active" : "adm-chart__bar"}
                />
                <text x={center} y={y(bar.value) - 8} textAnchor="middle" className="adm-chart__value">
                  {formatNumber(bar.value)}
                </text>
                {tilted ? (
                  <text
                    x={center}
                    y={baseline + 16}
                    textAnchor="end"
                    transform={`rotate(-32 ${center} ${baseline + 16})`}
                    className="adm-chart__tick"
                  >
                    {bar.label}
                  </text>
                ) : (
                  <text x={center} y={baseline + 18} textAnchor="middle" className="adm-chart__tick">
                    {bar.label}
                  </text>
                )}
              </g>
            );
          })}
          <text x={MARGIN.left + innerWidth / 2} y={svgHeight - 6} textAnchor="middle" className="adm-chart__axis-name">
            {xAxisLabel}
          </text>
        </svg>
      )}
    </div>
  );
}
