import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { formatNumber } from "../lib/format";
import type { Point } from "../preview/types";
import { MARGIN, labelStride, niceScale, useElementWidth } from "./chartScale";

interface LineChartProps {
  /** 읽어 주는 이름 */
  label: string;
  series: { name: string; points: Point[] };
  /** 회색 점선으로 함께 그리는 비교 선 */
  compare?: { name: string; points: Point[] };
  unit: string;
  xAxisLabel: string;
  height?: number;
}

/** 꺾은선. 값 사이를 곧게 이어 없는 굴곡을 만들지 않는다. */
export default function LineChart({ label, series, compare, unit, xAxisLabel, height = 240 }: LineChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(boxRef);
  const [active, setActive] = useState<number | null>(null);

  const points = series.points;
  const count = points.length;
  const maxValue = Math.max(...points.map((p) => p.value), ...(compare?.points.map((p) => p.value) ?? [0]));
  const { top, ticks } = niceScale(maxValue);
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = height - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + (count > 1 ? (index * innerWidth) / (count - 1) : innerWidth / 2);
  const y = (value: number) => MARGIN.top + innerHeight - (value / top) * innerHeight;
  const path = (line: Point[]) =>
    line.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const stride = labelStride(count, Math.max(2, Math.floor(innerWidth / 72)));

  const handlePointer = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const ratio = (event.clientX - left - MARGIN.left) / (innerWidth || 1);
    setActive(Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1)))));
  };
  const handleKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    setActive((current) => Math.min(count - 1, Math.max(0, (current ?? count - 1) + (current === null ? 0 : step))));
  };

  const values = points.map((p) => p.value);
  const summary = `${label}. ${points[0]?.label ?? ""}부터 ${points.at(-1)?.label ?? ""}까지 ${count}개 값, 가장 낮은 값 ${formatNumber(Math.min(...values))}${unit}, 가장 높은 값 ${formatNumber(Math.max(...values))}${unit}. 화살표 키로 값을 읽습니다.`;
  const hovered = active === null ? null : points[active];

  return (
    <div ref={boxRef} className="adm-chart">
      {width > 0 && count > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={summary}
          tabIndex={0}
          className="adm-chart__svg"
          onPointerMove={handlePointer}
          onPointerLeave={() => setActive(null)}
          onKeyDown={handleKey}
          onBlur={() => setActive(null)}
        >
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
          {points.map((p, i) =>
            i === count - 1 || (i % stride === 0 && count - 1 - i >= stride * 0.6) ? (
              <text
                key={p.label}
                x={x(i)}
                y={height - MARGIN.bottom + 18}
                textAnchor="middle"
                className="adm-chart__tick"
              >
                {p.label}
              </text>
            ) : null,
          )}
          <text x={MARGIN.left + innerWidth / 2} y={height - 6} textAnchor="middle" className="adm-chart__axis-name">
            {xAxisLabel}
          </text>
          {compare && <path d={path(compare.points)} className="adm-chart__compare" />}
          <path d={path(points)} className="adm-chart__line" />
          {hovered && active !== null && (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + innerHeight}
                className="adm-chart__guide"
              />
              <circle cx={x(active)} cy={y(hovered.value)} r={4} className="adm-chart__dot" />
            </g>
          )}
        </svg>
      )}
      {hovered && active !== null && (
        <div
          className="adm-chart__tip"
          style={{ left: Math.min(x(active), width - 120), top: Math.max(0, y(hovered.value) - 56) }}
          aria-hidden="true"
        >
          <span className="adm-chart__tip-label">{hovered.label}</span>
          <span>
            {series.name} <b>{formatNumber(hovered.value)}</b>
            {unit}
          </span>
          {compare?.points[active] && (
            <span className="adm-chart__tip-compare">
              {compare.name} {formatNumber(compare.points[active].value)}
              {unit}
            </span>
          )}
        </div>
      )}
      {compare && (
        <ul className="adm-legend">
          <li>
            <i className="adm-legend__swatch is-main" /> {series.name}
          </li>
          <li>
            <i className="adm-legend__swatch is-compare" /> {compare.name}
          </li>
        </ul>
      )}
    </div>
  );
}
