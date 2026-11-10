import { useEffect, useState, type RefObject } from "react";

/** 눈금이 1 · 2 · 2.5 · 5 × 10ⁿ 으로 떨어지게 위쪽 끝을 올린다. */
export function niceScale(max: number, tickCount = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, i) => i) };
  const rough = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? rough;
  return { top: step * tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, i) => step * i) };
}

/** 칸 폭을 잰다. 그래프는 px 로 그려야 글자가 늘어나지 않는다. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** 축 글자가 겹치지 않게 몇 칸마다 하나씩 쓸지. 마지막 칸은 늘 쓴다. */
export const labelStride = (count: number, maxLabels: number) => Math.max(1, Math.ceil(count / maxLabels));

export const MARGIN = { top: 28, right: 16, bottom: 44, left: 56 } as const;
