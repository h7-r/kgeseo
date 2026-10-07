import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { DESIGN_WIDTH, STAGE_INNER_CLASS, useStageScale } from "@/lib/stage";

const DEFAULT_BOTTOM_GAP = 72;

type Measured = [element: HTMLElement, offsetY: number];

function collectMeasurable(parent: Element, offsetY: number, out: Measured[]) {
  for (const child of parent.children) {
    if (!(child instanceof HTMLElement)) continue; // SVG 에는 offsetTop 이 없다.
    if ("shift" in child.dataset) collectMeasurable(child, offsetY + child.offsetTop, out);
    else out.push([child, offsetY]);
  }
}

function observeTree(observer: ResizeObserver, parent: Element) {
  for (const child of parent.children) {
    observer.observe(child);
    if (child instanceof HTMLElement && "shift" in child.dataset) observeTree(observer, child);
  }
}

interface StageProps {
  /** 첫 측정 전까지 쓸 높이. */
  height: number;
  /** 마지막 내용과 푸터 사이 간격. 띠가 푸터에 이어져야 하는 화면은 0. */
  bottomGap?: number;
  children: ReactNode;
}

/**
 * 1920 고정 좌표 디자인을 창 폭에 맞춰 축소해 그리는 칸.
 * 높이는 맨 아래 요소까지 재서 정한다 — 숫자로 박으면 푸터 아래로 빈 칸이 남는다.
 */
export default function Stage({ height, bottomGap = DEFAULT_BOTTOM_GAP, children }: StageProps) {
  const scale = useStageScale();
  const innerRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(height);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    const measure = () => {
      const measurable: Measured[] = [];
      collectMeasurable(inner, 0, measurable);

      let contentBottom = 0;
      let footerHeight = 0;
      for (const [element, offsetY] of measurable) {
        // 푸터는 bottom: 0 으로 붙어 있어 offsetTop 으로 재면 지금 높이가 되돌아온다.
        if ("footer" in element.dataset) {
          footerHeight = Math.max(footerHeight, element.offsetHeight);
          continue;
        }
        contentBottom = Math.max(contentBottom, element.offsetTop + offsetY + element.offsetHeight);
      }

      // 내용이 한 화면보다 짧아도 푸터가 창 바닥에 붙도록 한 화면 높이를 최소로 둔다.
      const viewportHeight = window.innerHeight / (window.innerWidth / DESIGN_WIDTH);
      const next = Math.ceil(Math.max(contentBottom + bottomGap + footerHeight, viewportHeight));
      if (Number.isFinite(next) && next > 0) setMeasuredHeight(next);
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(inner);
    observeTree(resizeObserver, inner);

    // 탭을 바꿔 새로 붙거나 빠진 자식도 다시 잰다.
    const mutationObserver = new MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            resizeObserver.observe(node);
            changed = true;
          }
        });
        if (record.removedNodes.length) changed = true;
      }
      if (changed) measure();
    });
    mutationObserver.observe(inner, { childList: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [bottomGap]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        // transform 은 배치 높이를 바꾸지 않으므로 겉칸 높이를 축소된 값으로 직접 잡는다.
        height: `${Math.round(measuredHeight * scale)}px`,
        // hidden 은 스크롤 칸을 만들어 scroll-driven 애니메이션의 기준을 빼앗는다. clip 은 자르기만 한다.
        overflow: "clip",
        background: "transparent",
      }}
    >
      <div
        ref={innerRef}
        className={STAGE_INNER_CLASS}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          // 한글은 띄어쓰기에서만 끊고, 칸보다 긴 덩이만 쪼갠다.
          wordBreak: "keep-all",
          overflowWrap: "anywhere",
          width: `${DESIGN_WIDTH}px`,
          height: `${measuredHeight}px`,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
